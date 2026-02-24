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

/**
 * Fixes "flattened" markdown where the model outputs bold headings, bullet
 * points, and numbered lists on a single line with no line breaks.
 *
 * Example input:
 *   "recap: **today:** - item one - item two **yesterday:** - item three"
 * Output:
 *   "recap:\n\n**today:**\n- item one\n- item two\n\n**yesterday:**\n- item three"
 *
 * Only triggers when the text has very few newlines relative to its structural
 * marker density, to avoid breaking already-formatted text.
 */
export function fixFlattenedMarkdown(text: string): string {
  if (!text || text.length < 60) {
    return text;
  }
  const existingNewlines = (text.match(/\n/g) || []).length;
  // Count structural markers (broad detection for flattened output)
  const boldHeaders = (text.match(/ \*\*[^*]+:\*\*/g) || []).length;
  const dashBullets = (text.match(/ - (?:\*\*|[A-Z0-9])/g) || []).length;
  const asteriskBullets = (text.match(/ \* (?:\*\*|[A-Z])/g) || []).length;
  const numberedItems = (text.match(/ \d+\. /g) || []).length;
  const emojiHeaders = (text.match(/ [\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*\*\*/gu) || [])
    .length;
  const structureCount = boldHeaders + dashBullets + asteriskBullets + numberedItems + emojiHeaders;

  // Trigger if text has structural markers but very few newlines
  if (structureCount >= 2 && existingNewlines <= structureCount * 0.5) {
    let fixed = text;
    // Numbered items: " 1. text" → "\n1. text"
    fixed = fixed.replace(/ (\d+\. )/g, "\n$1");
    // Dash bullets: " - text" → "\n- text" (broad: catches lowercase too)
    fixed = fixed.replace(/ (- (?:\*\*|[A-Z0-9]))/g, "\n$1");
    // Asterisk bullets: " * text" → "\n* text"
    fixed = fixed.replace(/ (\* (?:\*\*|[A-Z]))/g, "\n$1");
    // Standalone bold headers: " **heading:**" → "\n\n**heading:**"
    fixed = fixed.replace(/(?<=[^\n\-*\d.]) (\*\*[^*]+:\*\*)/g, "\n\n$1");
    // Emoji followed by bold (section header): " 📊 **Title**" → "\n\n📊 **Title**"
    fixed = fixed.replace(/ ([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*\*\*)/gu, "\n\n$1");
    // Markdown headings: " ## " → "\n\n## "
    fixed = fixed.replace(/ (#{1,6} )/g, "\n\n$1");
    // Clean up excessive newlines (3+ → 2)
    fixed = fixed.replace(/\n{3,}/g, "\n\n");
    return fixed.trim();
  }

  // Fallback: long text (>250 chars) with zero newlines — insert paragraph breaks
  // between sentences to prevent wall-of-text output.
  if (existingNewlines === 0 && text.length > 250) {
    const sentences = text.split(/(?<=\.) (?=[A-Z])/);
    if (sentences.length >= 4) {
      // Group ~2-3 sentences per paragraph
      const paragraphs: string[] = [];
      let current: string[] = [];
      for (const sentence of sentences) {
        current.push(sentence);
        if (current.join(" ").length > 150) {
          paragraphs.push(current.join(" "));
          current = [];
        }
      }
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
      }
      if (paragraphs.length >= 2) {
        return paragraphs.join("\n\n");
      }
    }
  }

  return text;
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
    text = fixFlattenedMarkdown(text);
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
