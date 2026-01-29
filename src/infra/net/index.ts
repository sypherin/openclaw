/**
 * Network Security Module
 *
 * Provides comprehensive network security controls including:
 * - Connection allowlisting (domain-based access control)
 * - SSRF protection (blocks private IPs and internal hostnames)
 * - Secure fetch wrapper (combines all protections)
 */

export {
  // Connection Allowlist
  type AllowlistConfig,
  type AllowlistEntry,
  type ConnectionAttempt,
  type ConnectionCategory,
  ConnectionAllowlist,
  getConnectionAllowlist,
  checkConnection,
  assertConnectionAllowed,
} from "./connection-allowlist.js";

export {
  // SSRF Protection
  SsrFBlockedError,
  isPrivateIpAddress,
  isBlockedHostname,
  resolvePinnedHostname,
  createPinnedDispatcher,
  createPinnedLookup,
  closeDispatcher,
  assertPublicHostname,
  type PinnedHostname,
} from "./ssrf.js";

export {
  // Secure Fetch
  type SecureFetchConfig,
  type SecureFetchResult,
  SecureFetchError,
  secureFetch,
  validateUrl,
  getSecureFetchStats,
  getSecureFetchLog,
} from "./secure-fetch.js";
