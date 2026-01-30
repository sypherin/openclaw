/**
 * SECURITY: Secure Fetch Module
 *
 * Combines SSRF protection with connection allowlisting for defense-in-depth.
 * All outbound HTTP requests should go through this module when possible.
 *
 * Security layers:
 * 1. Connection allowlist - Blocks connections to unapproved domains
 * 2. SSRF protection - Blocks private IPs and internal hostnames
 * 3. DNS pinning - Prevents DNS rebinding attacks
 */

import { checkConnection, getConnectionAllowlist } from "./connection-allowlist.js";
import {
  resolvePinnedHostname,
  createPinnedDispatcher,
  closeDispatcher,
  SsrFBlockedError,
} from "./ssrf.js";

export type SecureFetchConfig = {
  /** Enforce connection allowlist (false = log-only) */
  enforceAllowlist: boolean;
  /** Enforce SSRF protection (false = log-only) */
  enforceSsrf: boolean;
  /** Log all connection attempts */
  logConnections: boolean;
  /** Source identifier for logging */
  source?: string;
};

export type SecureFetchResult = {
  response: Response;
  pinnedHostname?: string;
  pinnedAddresses?: string[];
};

const DEFAULT_CONFIG: SecureFetchConfig = {
  enforceAllowlist: true,
  enforceSsrf: true,
  logConnections: true,
};

export class SecureFetchError extends Error {
  readonly code: "allowlist_blocked" | "ssrf_blocked" | "fetch_failed";
  readonly url: string;

  constructor(code: SecureFetchError["code"], url: string, message: string) {
    super(message);
    this.name = "SecureFetchError";
    this.code = code;
    this.url = url;
  }
}

/**
 * Perform a secure fetch with allowlist and SSRF protection.
 */
export async function secureFetch(
  url: string | URL,
  init?: RequestInit,
  config?: Partial<SecureFetchConfig>,
): Promise<SecureFetchResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const urlString = url instanceof URL ? url.href : url;

  // Layer 1: Check connection allowlist
  const allowlistCheck = checkConnection(urlString, cfg.source);
  if (!allowlistCheck.allowed && cfg.enforceAllowlist) {
    throw new SecureFetchError(
      "allowlist_blocked",
      urlString,
      `Connection to ${allowlistCheck.domain} blocked by allowlist: ${allowlistCheck.reason}. ` +
        `Add the domain to the allowlist if this connection is expected.`,
    );
  }

  // Parse URL to get hostname for SSRF check
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new SecureFetchError("fetch_failed", urlString, `Invalid URL: ${urlString}`);
  }

  // Layer 2: SSRF protection with DNS pinning
  let pinnedHostname: string | undefined;
  let pinnedAddresses: string[] | undefined;
  let dispatcher: import("undici").Dispatcher | undefined;

  try {
    const pinned = await resolvePinnedHostname(parsedUrl.hostname);
    pinnedHostname = pinned.hostname;
    pinnedAddresses = pinned.addresses;
    dispatcher = createPinnedDispatcher(pinned);
  } catch (err) {
    if (err instanceof SsrFBlockedError) {
      if (cfg.enforceSsrf) {
        throw new SecureFetchError(
          "ssrf_blocked",
          urlString,
          `Connection blocked by SSRF protection: ${err.message}`,
        );
      }
      // Log but continue if not enforcing
      if (cfg.logConnections) {
        console.warn(`[secure-fetch] SSRF warning (not enforced): ${err.message}`);
      }
    } else {
      throw new SecureFetchError(
        "fetch_failed",
        urlString,
        `DNS resolution failed for ${parsedUrl.hostname}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Layer 3: Perform the fetch with pinned DNS
  try {
    const fetchInit: RequestInit & { dispatcher?: import("undici").Dispatcher } = {
      ...init,
    };
    if (dispatcher) {
      fetchInit.dispatcher = dispatcher;
    }

    const response = await fetch(urlString, fetchInit);

    return {
      response,
      pinnedHostname,
      pinnedAddresses,
    };
  } catch (err) {
    throw new SecureFetchError(
      "fetch_failed",
      urlString,
      `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await closeDispatcher(dispatcher);
  }
}

/**
 * Check if a URL is allowed by the allowlist and SSRF protection.
 * Does not make an actual request - just validates.
 */
export async function validateUrl(
  url: string,
  config?: Partial<SecureFetchConfig>,
): Promise<{
  allowed: boolean;
  allowlistResult: ReturnType<typeof checkConnection>;
  ssrfResult?: { hostname: string; addresses: string[] };
  error?: string;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check allowlist
  const allowlistResult = checkConnection(url, cfg.source);
  if (!allowlistResult.allowed && cfg.enforceAllowlist) {
    return {
      allowed: false,
      allowlistResult,
      error: `Blocked by allowlist: ${allowlistResult.reason}`,
    };
  }

  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      allowed: false,
      allowlistResult,
      error: `Invalid URL: ${url}`,
    };
  }

  // Check SSRF
  try {
    const pinned = await resolvePinnedHostname(parsedUrl.hostname);
    return {
      allowed: true,
      allowlistResult,
      ssrfResult: {
        hostname: pinned.hostname,
        addresses: pinned.addresses,
      },
    };
  } catch (err) {
    if (err instanceof SsrFBlockedError && cfg.enforceSsrf) {
      return {
        allowed: false,
        allowlistResult,
        error: `SSRF blocked: ${err.message}`,
      };
    }
    if (err instanceof SsrFBlockedError) {
      // SSRF not enforced, log warning
      return {
        allowed: !cfg.enforceAllowlist || allowlistResult.allowed,
        allowlistResult,
        error: `SSRF warning (not enforced): ${err.message}`,
      };
    }
    return {
      allowed: false,
      allowlistResult,
      error: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get connection statistics for monitoring.
 */
export function getSecureFetchStats() {
  return getConnectionAllowlist().getStats();
}

/**
 * Get recent connection log for auditing.
 */
export function getSecureFetchLog(limit = 100, deniedOnly = false) {
  return getConnectionAllowlist().getConnectionLog(limit, deniedOnly);
}

/**
 * Update allowlist configuration at runtime.
 */
export function updateAllowlistConfig(
  config: Partial<import("./connection-allowlist.js").AllowlistConfig>,
) {
  const allowlist = getConnectionAllowlist();
  allowlist.updateConfig(config);
  return allowlist;
}
