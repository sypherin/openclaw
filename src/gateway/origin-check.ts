import { isLoopbackHost, normalizeHostHeader, resolveHostName } from "./net.js";

type OriginCheckResult = { ok: true } | { ok: false; reason: string };

function parseOrigin(
  originRaw?: string,
): { origin: string; host: string; hostname: string; protocol: string } | null {
  const trimmed = (originRaw ?? "").trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return {
      origin: url.origin.toLowerCase(),
      host: url.host.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
      protocol: url.protocol.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Check if origin protocol is compatible with request protocol.
 * HTTPS origins can access WSS endpoints; HTTP origins can access WS endpoints.
 * Prevents cross-protocol WebSocket hijacking (CSWSH).
 */
const COMPATIBLE_PROTOCOLS: Record<string, Set<string>> = {
  "https:": new Set(["https:", "wss:"]),
  "http:": new Set(["http:", "ws:"]),
  "wss:": new Set(["https:", "wss:"]),
  "ws:": new Set(["http:", "ws:"]),
};

export function checkBrowserOrigin(params: {
  requestHost?: string;
  origin?: string;
  allowedOrigins?: string[];
}): OriginCheckResult {
  const parsedOrigin = parseOrigin(params.origin);
  if (!parsedOrigin) {
    return { ok: false, reason: "origin missing or invalid" };
  }

  const allowlist = (params.allowedOrigins ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(parsedOrigin.origin)) {
    return { ok: true };
  }

  const requestHost = normalizeHostHeader(params.requestHost);
  if (requestHost && parsedOrigin.host === requestHost) {
    // Also verify protocol compatibility to prevent cross-protocol CSWSH
    const compatible = COMPATIBLE_PROTOCOLS[parsedOrigin.protocol];
    if (!compatible || compatible.has(parsedOrigin.protocol)) {
      return { ok: true };
    }
    // Loopback connections are exempt from protocol matching (local dev)
    if (isLoopbackHost(parsedOrigin.hostname)) {
      return { ok: true };
    }
    return { ok: false, reason: "origin protocol mismatch" };
  }

  const requestHostname = resolveHostName(requestHost);
  if (isLoopbackHost(parsedOrigin.hostname) && isLoopbackHost(requestHostname)) {
    return { ok: true };
  }

  return { ok: false, reason: "origin not allowed" };
}
