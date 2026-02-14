import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

// ── SSE parser ───────────────────────────────────────────────────────────────

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        return;
      }
      try {
        yield JSON.parse(payload) as Record<string, unknown>;
      } catch {
        // skip malformed SSE events
      }
    }
  }
}

// ── Reasoning content extraction ─────────────────────────────────────────────

interface OpenAIDelta {
  content?: string | null;
  reasoning_content?: string | null;
  role?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIChoice {
  index: number;
  delta?: OpenAIDelta;
  message?: OpenAIDelta & { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string | null;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function extractDeltaText(delta: OpenAIDelta | undefined): { content: string; reasoning: string } {
  if (!delta) {
    return { content: "", reasoning: "" };
  }
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning: typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
  };
}

// ── Main StreamFn factory ────────────────────────────────────────────────────

/**
 * Create a StreamFn that handles NVIDIA's GLM reasoning models.
 *
 * These models return `reasoning_content` instead of `content` in both
 * streaming deltas and non-streaming responses. This wrapper intercepts
 * the raw API response and maps reasoning_content → content when content
 * is null/empty.
 */
export function createNvidiaReasoningStreamFn(): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        // Build request body (standard OpenAI chat completions format)
        const messages: Array<Record<string, unknown>> = [];

        if (context.systemPrompt) {
          messages.push({ role: "system", content: context.systemPrompt });
        }

        for (const msg of context.messages ?? []) {
          const m = msg as unknown as Record<string, unknown>;
          if (m.role === "user" || m.role === "assistant" || m.role === "system") {
            const content = m.content;
            if (typeof content === "string") {
              messages.push({ role: m.role, content });
            } else if (Array.isArray(content)) {
              // Extract text from content blocks
              const text = (content as Array<{ type?: string; text?: string }>)
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("");
              if (text) {
                messages.push({ role: m.role, content: text });
              }
            }
          } else if (m.role === "tool" || m.role === "toolResult") {
            const content =
              typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                  ? (m.content as Array<{ type?: string; text?: string }>)
                      .filter((b) => typeof b.text === "string")
                      .map((b) => b.text)
                      .join("")
                  : "";
            messages.push({ role: "tool", content, tool_call_id: m.toolCallId ?? "" });
          }
        }

        const body: Record<string, unknown> = {
          model: model.id,
          messages,
          stream: true,
        };
        if (typeof options?.maxTokens === "number") {
          body.max_tokens = options.maxTokens;
        } else if (typeof model.maxTokens === "number") {
          body.max_tokens = model.maxTokens;
        }
        if (typeof options?.temperature === "number") {
          body.temperature = options.temperature;
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...options?.headers,
        };
        if (options?.apiKey) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const baseUrl = (model.baseUrl ?? "").replace(/\/+$/, "");
        const url = `${baseUrl}/chat/completions`;

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "unknown error");
          throw new Error(`NVIDIA API error ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error("NVIDIA API returned empty response body");
        }

        const reader = response.body.getReader();
        let accumulatedContent = "";
        let accumulatedReasoning = "";
        let finishReason: string | null = null;
        let usage: OpenAIUsage = {};

        for await (const chunk of parseSSEStream(reader)) {
          const choices = chunk.choices as OpenAIChoice[] | undefined;
          if (!choices || choices.length === 0) {
            if (chunk.usage) {
              usage = chunk.usage as OpenAIUsage;
            }
            continue;
          }

          const choice = choices[0];

          // Handle streaming delta format
          if (choice.delta) {
            const { content, reasoning } = extractDeltaText(choice.delta);
            accumulatedContent += content;
            accumulatedReasoning += reasoning;
          }

          // Handle non-streaming message format
          if (choice.message) {
            const msg = choice.message;
            if (typeof msg.content === "string") {
              accumulatedContent = msg.content;
            }
            if (typeof msg.reasoning_content === "string") {
              accumulatedReasoning = msg.reasoning_content;
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (chunk.usage) {
            usage = chunk.usage as OpenAIUsage;
          }
        }

        // Key mapping: if content is empty but reasoning has text, use reasoning as content
        const finalText = accumulatedContent.trim() || accumulatedReasoning.trim();

        const contentBlocks: TextContent[] = [];
        if (finalText) {
          contentBlocks.push({ type: "text", text: finalText });
        }

        const stopReason: StopReason =
          finishReason === "length" ? "length" : finishReason === "tool_calls" ? "toolUse" : "stop";

        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content: contentBlocks,
          stopReason,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: usage.prompt_tokens ?? 0,
            output: usage.completion_tokens ?? 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: usage.total_tokens ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          timestamp: Date.now(),
        };

        stream.push({
          type: "done",
          reason: stopReason === "toolUse" ? "toolUse" : "stop",
          message: assistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

/**
 * Check if a model should use the NVIDIA reasoning stream wrapper.
 * Returns true for models whose IDs match known GLM reasoning models
 * on NVIDIA's API that return reasoning_content instead of content.
 */
export function isNvidiaReasoningModel(provider: string, modelId: string): boolean {
  const id = modelId.toLowerCase();
  return provider.startsWith("nvidia-glm") && (id.includes("glm") || id.includes("z-ai"));
}
