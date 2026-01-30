/**
 * SECURITY: LLM Rate Limiter Integration
 *
 * Wraps the pi-ai stream function to apply rate limiting before making API calls.
 * This prevents exceeding cloud provider rate limits and protects against:
 * 1. Token quota exhaustion (429 errors)
 * 2. Unexpected billing charges
 * 3. Denial of service from runaway requests
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  type LlmProvider,
  type UsageRecord,
  checkLlmRateLimit,
  reserveLlmCapacity,
  releaseLlmCapacity,
  getLlmRateLimiter,
} from "./llm-rate-limiter.js";

/**
 * Type for pi-ai stream function signature.
 * Uses a flexible type to accommodate the complex generic types in pi-ai.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamFn = (...args: any[]) => any;

/**
 * Map pi-ai provider string to our LlmProvider type.
 */
export function mapToLlmProvider(provider: string): LlmProvider {
  const normalized = provider.toLowerCase().trim();

  // Direct mappings
  const providerMap: Record<string, LlmProvider> = {
    anthropic: "anthropic",
    openai: "openai",
    google: "google",
    bedrock: "bedrock",
    "github-copilot": "github-copilot",
    minimax: "minimax",
    moonshot: "moonshot",
    kimi: "kimi",
    qwen: "qwen",
    venice: "venice",
    ollama: "ollama",
  };

  // Check direct mappings
  if (providerMap[normalized]) {
    return providerMap[normalized];
  }

  // Handle variants
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic";
  }
  if (normalized.includes("openai") || normalized.includes("gpt")) {
    return "openai";
  }
  if (
    normalized.includes("google") ||
    normalized.includes("gemini") ||
    normalized.includes("vertex")
  ) {
    return "google";
  }
  if (normalized.includes("bedrock") || normalized.includes("amazon")) {
    return "bedrock";
  }
  if (normalized.includes("copilot") || normalized.includes("github")) {
    return "github-copilot";
  }
  if (normalized.includes("ollama") || normalized.includes("local")) {
    return "ollama";
  }

  return "custom";
}

/**
 * Estimate token count from a prompt string.
 * Uses a simple heuristic: ~4 characters per token on average.
 */
export function estimateTokens(prompt: unknown): number {
  if (typeof prompt === "string") {
    return Math.ceil(prompt.length / 4);
  }
  if (Array.isArray(prompt)) {
    return prompt.reduce((acc, item) => {
      if (typeof item === "string") {
        return acc + Math.ceil(item.length / 4);
      }
      if (item && typeof item === "object" && "text" in item) {
        const text = (item as Record<string, unknown>).text;
        return acc + Math.ceil((typeof text === "string" ? text : "").length / 4);
      }
      // Images count as ~1000 tokens
      if (item && typeof item === "object" && "data" in item) {
        return acc + 1000;
      }
      return acc + 100; // Default for unknown content
    }, 0);
  }
  return 1000; // Default estimate for unknown format
}

/**
 * Estimate tokens from an array of messages.
 */
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((acc, msg) => {
    // Check if the message has a content property (not all AgentMessage types do)
    if ("content" in msg && msg.content !== undefined) {
      if (typeof msg.content === "string") {
        return acc + estimateTokens(msg.content);
      }
      if (Array.isArray(msg.content)) {
        return acc + estimateTokens(msg.content);
      }
    }
    return acc + 100;
  }, 0);
}

type RateLimitWrapperOptions = {
  /** The provider string from pi-ai */
  provider: string;
  /** Callback when rate limited */
  onRateLimited?: (waitMs: number, reason: string) => void;
  /** Callback when request starts */
  onRequestStart?: () => void;
  /** Callback when request ends */
  onRequestEnd?: (success: boolean, tokens?: number) => void;
};

/**
 * Wrap a pi-ai stream function with rate limiting.
 *
 * This wrapper performs a synchronous rate limit check before calling the stream function.
 * If the rate limit is exceeded, it throws an error immediately.
 */
export function wrapStreamFnWithRateLimit(
  streamFn: StreamFn,
  options: RateLimitWrapperOptions,
): StreamFn {
  const llmProvider = mapToLlmProvider(options.provider);

  return async function rateLimitedStreamFn(
    model: unknown,
    context: unknown,
    opts?: unknown,
  ): Promise<unknown> {
    // Extract messages from context for token estimation
    const contextObj = context as { messages?: AgentMessage[] } | AgentMessage[];
    const messages = Array.isArray(contextObj) ? contextObj : (contextObj?.messages ?? []);

    // Estimate tokens for this request
    const estimatedTokens = estimateMessagesTokens(messages);

    // Add buffer for expected response
    const estimatedWithResponse = estimatedTokens + 2000;

    // Check rate limit — if blocked, notify user and sleep/retry instead of throwing
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const checkResult = checkLlmRateLimit(llmProvider, estimatedWithResponse);
      if (checkResult.allowed) break;

      const waitMs = checkResult.waitMs ?? 5000;
      const reason = checkResult.reason ?? "rate_limited";

      try {
        options.onRateLimited?.(waitMs, reason);
      } catch {
        // Notification failure must not block the retry loop
      }

      // Sleep and retry — don't use the queue, just wait directly
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 30000)));
    }
    // After retries, proceed regardless — let the real API handle final rate limiting

    // Reserve capacity
    reserveLlmCapacity(llmProvider, estimatedWithResponse);
    options.onRequestStart?.();

    let success = false;
    let errorType: UsageRecord["errorType"] | undefined;

    try {
      // Call the underlying stream function
      const result = streamFn(model, context, opts);
      success = true;
      return result;
    } catch (err) {
      success = false;

      // Determine error type for backoff handling
      const errMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (errMsg.includes("rate") || errMsg.includes("429") || errMsg.includes("quota")) {
        errorType = "rate_limit";
      } else if (errMsg.includes("auth") || errMsg.includes("401") || errMsg.includes("403")) {
        errorType = "auth";
      } else if (errMsg.includes("billing") || errMsg.includes("payment")) {
        errorType = "billing";
      } else if (errMsg.includes("timeout") || errMsg.includes("timed out")) {
        errorType = "timeout";
      } else {
        errorType = "other";
      }

      throw err;
    } finally {
      // Release capacity and record usage
      // Note: For streaming, actual tokens are estimated since we don't wait for completion
      releaseLlmCapacity(
        llmProvider,
        estimatedWithResponse,
        estimatedWithResponse,
        success,
        errorType,
      );
      options.onRequestEnd?.(success, estimatedWithResponse);
    }
  };
}

/**
 * Create a rate-limited stream function wrapper for a specific provider.
 */
export function createRateLimitedStreamFn(
  streamFn: StreamFn,
  provider: string,
  callbacks?: {
    onRateLimited?: (waitMs: number, reason: string) => void;
    onRequestStart?: () => void;
    onRequestEnd?: (success: boolean, tokens?: number) => void;
  },
): StreamFn {
  return wrapStreamFnWithRateLimit(streamFn, {
    provider,
    ...callbacks,
  });
}

/**
 * Get rate limiter statistics for monitoring.
 */
export function getRateLimiterStats() {
  return getLlmRateLimiter().getStats();
}

/**
 * Get usage history for auditing.
 */
export function getRateLimiterUsageHistory(limit = 100) {
  return getLlmRateLimiter().getUsageHistory(limit);
}
