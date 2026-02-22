import { sanitizeUserFacingText } from "../../agents/pi-embedded-helpers.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import { HEARTBEAT_TOKEN, isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";
import type { ReplyPayload } from "../types.js";
import { hasLineDirectives, parseLineDirectives } from "./line-directives.js";
import {
  resolveResponsePrefixTemplate,
  type ResponsePrefixContext,
} from "./response-prefix-template.js";

/**
 * Strips leaked chain-of-thought / reasoning text that some models (e.g. GLM 4.7)
 * accidentally include in the assistant text instead of keeping it in a separate
 * `thinking` content block.
 *
 * Handles:
 *  - XML-wrapped blocks: <think>…</think>, <thinking>…</thinking>, <reasoning>…</reasoning>
 *  - Inline thinking prefixes like "Let me think about this..." that precede the real answer.
 */
const THINKING_BLOCK_RE =
  /<(?:think|thinking|reasoning|internal_thoughts|chain_of_thought|reflection)>[\s\S]*?<\/(?:think|thinking|reasoning|internal_thoughts|chain_of_thought|reflection)>/gi;

const THINKING_PREFIX_RE =
  /^(?:(?:The )?user (?:is asking|wants|asked|said|has asked|is requesting|seems to|appears to)\b.*?\n+)+/i;

export function stripThinkingTextLeaks(text: string): string {
  if (!text) {
    return text;
  }
  // Strip XML-wrapped thinking blocks
  let cleaned = text.replace(THINKING_BLOCK_RE, "").trim();
  // Strip leading meta-commentary about the user's intent
  cleaned = cleaned.replace(THINKING_PREFIX_RE, "").trim();
  return cleaned || text; // fallback to original if everything was stripped
}

export type NormalizeReplySkipReason = "empty" | "silent" | "heartbeat";

export type NormalizeReplyOptions = {
  responsePrefix?: string;
  /** Context for template variable interpolation in responsePrefix */
  responsePrefixContext?: ResponsePrefixContext;
  onHeartbeatStrip?: () => void;
  stripHeartbeat?: boolean;
  silentToken?: string;
  onSkip?: (reason: NormalizeReplySkipReason) => void;
};

export function normalizeReplyPayload(
  payload: ReplyPayload,
  opts: NormalizeReplyOptions = {},
): ReplyPayload | null {
  const hasMedia = Boolean(payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0);
  const hasChannelData = Boolean(
    payload.channelData && Object.keys(payload.channelData).length > 0,
  );
  const trimmed = payload.text?.trim() ?? "";
  if (!trimmed && !hasMedia && !hasChannelData) {
    opts.onSkip?.("empty");
    return null;
  }

  const silentToken = opts.silentToken ?? SILENT_REPLY_TOKEN;
  let text = payload.text ?? undefined;
  if (text && isSilentReplyText(text, silentToken)) {
    if (!hasMedia && !hasChannelData) {
      opts.onSkip?.("silent");
      return null;
    }
    text = "";
  }
  if (text && !trimmed) {
    // Keep empty text when media exists so media-only replies still send.
    text = "";
  }

  const shouldStripHeartbeat = opts.stripHeartbeat ?? true;
  if (shouldStripHeartbeat && text?.includes(HEARTBEAT_TOKEN)) {
    const stripped = stripHeartbeatToken(text, { mode: "message" });
    if (stripped.didStrip) {
      opts.onHeartbeatStrip?.();
    }
    if (stripped.shouldSkip && !hasMedia && !hasChannelData) {
      opts.onSkip?.("heartbeat");
      return null;
    }
    text = stripped.text;
  }

  if (text) {
    text = sanitizeUserFacingText(text, { errorContext: Boolean(payload.isError) });
    text = stripThinkingTextLeaks(text);
  }
  if (!text?.trim() && !hasMedia && !hasChannelData) {
    opts.onSkip?.("empty");
    return null;
  }

  // Parse LINE-specific directives from text (quick_replies, location, confirm, buttons)
  let enrichedPayload: ReplyPayload = { ...payload, text };
  if (text && hasLineDirectives(text)) {
    enrichedPayload = parseLineDirectives(enrichedPayload);
    text = enrichedPayload.text;
  }

  // Resolve template variables in responsePrefix if context is provided
  const effectivePrefix = opts.responsePrefixContext
    ? resolveResponsePrefixTemplate(opts.responsePrefix, opts.responsePrefixContext)
    : opts.responsePrefix;

  if (
    effectivePrefix &&
    text &&
    text.trim() !== HEARTBEAT_TOKEN &&
    !text.startsWith(effectivePrefix)
  ) {
    text = `${effectivePrefix} ${text}`;
  }

  return { ...enrichedPayload, text };
}
