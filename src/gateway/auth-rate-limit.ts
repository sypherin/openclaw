/**
 * SECURITY: Rate limiting for authentication attempts.
 * Prevents brute-force attacks by tracking failed authentication attempts
 * and applying exponential backoff with progressive lockout.
 */

export type RateLimitConfig = {
  /** Maximum attempts before lockout */
  maxAttempts: number;
  /** Time window in milliseconds for counting attempts */
  windowMs: number;
  /** Initial backoff delay in milliseconds */
  baseBackoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** How long to keep lockout records after they expire */
  cleanupIntervalMs: number;
};

type AttemptRecord = {
  /** Number of failed attempts in current window */
  attempts: number;
  /** Timestamp of first attempt in window */
  windowStart: number;
  /** Timestamp of last attempt */
  lastAttempt: number;
  /** Currently locked out until this timestamp */
  lockedUntil: number;
};

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 60_000, // 1 minute
  baseBackoffMs: 1_000, // 1 second
  maxBackoffMs: 300_000, // 5 minutes max lockout
  cleanupIntervalMs: 600_000, // Clean up every 10 minutes
};

/**
 * In-memory rate limiter for authentication attempts.
 * Tracks attempts by client identifier (typically IP address).
 */
export class AuthRateLimiter {
  private records = new Map<string, AttemptRecord>();
  private config: RateLimitConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Check if a client is currently rate limited.
   * @param clientId - Identifier for the client (e.g., IP address)
   * @returns Object indicating if allowed, and if not, how long to wait
   */
  check(clientId: string): { allowed: boolean; retryAfterMs?: number; attempts?: number } {
    const now = Date.now();
    const record = this.records.get(clientId);

    if (!record) {
      return { allowed: true };
    }

    // Check if currently locked out
    if (record.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterMs: record.lockedUntil - now,
        attempts: record.attempts,
      };
    }

    // Check if window has expired - reset if so
    if (now - record.windowStart > this.config.windowMs) {
      this.records.delete(clientId);
      return { allowed: true };
    }

    // Check if at max attempts
    if (record.attempts >= this.config.maxAttempts) {
      // Calculate backoff based on how many times they've hit the limit
      const lockoutCount = Math.floor(record.attempts / this.config.maxAttempts);
      const backoffMs = Math.min(
        this.config.baseBackoffMs * Math.pow(2, lockoutCount - 1),
        this.config.maxBackoffMs,
      );
      record.lockedUntil = now + backoffMs;
      return {
        allowed: false,
        retryAfterMs: backoffMs,
        attempts: record.attempts,
      };
    }

    return { allowed: true, attempts: record.attempts };
  }

  /**
   * Record a failed authentication attempt.
   * @param clientId - Identifier for the client (e.g., IP address)
   */
  recordFailure(clientId: string): void {
    const now = Date.now();
    const record = this.records.get(clientId);

    if (!record) {
      this.records.set(clientId, {
        attempts: 1,
        windowStart: now,
        lastAttempt: now,
        lockedUntil: 0,
      });
      return;
    }

    // Reset window if expired
    if (now - record.windowStart > this.config.windowMs) {
      record.attempts = 1;
      record.windowStart = now;
      record.lockedUntil = 0;
    } else {
      record.attempts++;
    }
    record.lastAttempt = now;
  }

  /**
   * Record a successful authentication (resets the failure count).
   * @param clientId - Identifier for the client (e.g., IP address)
   */
  recordSuccess(clientId: string): void {
    this.records.delete(clientId);
  }

  /**
   * Get the current status for a client.
   * @param clientId - Identifier for the client
   */
  getStatus(clientId: string): {
    attempts: number;
    isLocked: boolean;
    lockedUntil?: number;
  } {
    const record = this.records.get(clientId);
    if (!record) {
      return { attempts: 0, isLocked: false };
    }
    const now = Date.now();
    return {
      attempts: record.attempts,
      isLocked: record.lockedUntil > now,
      lockedUntil: record.lockedUntil > now ? record.lockedUntil : undefined,
    };
  }

  /**
   * Clean up expired records to prevent memory leaks.
   */
  private cleanup(): void {
    const now = Date.now();
    const expireThreshold = this.config.windowMs + this.config.maxBackoffMs;

    for (const [clientId, record] of this.records) {
      const timeSinceLastAttempt = now - record.lastAttempt;
      if (timeSinceLastAttempt > expireThreshold && record.lockedUntil <= now) {
        this.records.delete(clientId);
      }
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref(); // Don't keep process alive for cleanup
  }

  /**
   * Stop the rate limiter and clean up resources.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.records.clear();
  }

  /**
   * Get statistics about the rate limiter.
   */
  getStats(): { trackedClients: number; lockedClients: number } {
    const now = Date.now();
    let lockedClients = 0;
    for (const record of this.records.values()) {
      if (record.lockedUntil > now) {
        lockedClients++;
      }
    }
    return {
      trackedClients: this.records.size,
      lockedClients,
    };
  }
}

// Singleton instance for gateway authentication
let gatewayAuthRateLimiter: AuthRateLimiter | null = null;

/**
 * Get the singleton rate limiter for gateway authentication.
 */
export function getGatewayAuthRateLimiter(): AuthRateLimiter {
  if (!gatewayAuthRateLimiter) {
    gatewayAuthRateLimiter = new AuthRateLimiter();
  }
  return gatewayAuthRateLimiter;
}

/**
 * Check if authentication is rate limited for a client.
 * @param clientIp - Client IP address
 * @returns Rate limit status
 */
export function checkAuthRateLimit(clientIp: string): {
  allowed: boolean;
  retryAfterMs?: number;
  attempts?: number;
} {
  return getGatewayAuthRateLimiter().check(clientIp);
}

/**
 * Record a failed authentication attempt.
 * @param clientIp - Client IP address
 */
export function recordAuthFailure(clientIp: string): void {
  getGatewayAuthRateLimiter().recordFailure(clientIp);
}

/**
 * Record a successful authentication (clears rate limit tracking).
 * @param clientIp - Client IP address
 */
export function recordAuthSuccess(clientIp: string): void {
  getGatewayAuthRateLimiter().recordSuccess(clientIp);
}
