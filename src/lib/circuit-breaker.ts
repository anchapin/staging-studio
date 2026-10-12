import {
  checkAndRecordRateLimit,
  checkRateLimit,
  clearRateLimit,
  type RateLimitResult,
} from "@/lib/sliding-window-ratelimit";

/**
 * Circuit breaker for external provider calls (fal.ai, Browserless).
 *
 * Issue #1123: breaker state used to live in a module-level Map, which on
 * serverless is per-lambda-instance — each instance counted its own
 * failures, so the threshold was effectively `failureThreshold x N`
 * instances and the breaker never opened for real traffic. State now lives
 * in the Postgres sliding-window limiter (DailyApiUsage rows keyed
 * `circuit-breaker:<service>`), shared across every instance.
 *
 * Semantics (deliberate changes from the in-memory version):
 * - OPEN is implicit: `failureThreshold` recorded failures inside
 *   `cooldownMs` make `execute` throw CircuitBreakerOpenError before the
 *   call is attempted. There is no HALF_OPEN probe state; recovery is
 *   implicit as failures slide out of the window, and any success clears
 *   the circuit outright.
 * - The call whose failure trips the threshold surfaces the ORIGINAL
 *   error; the breaker opens for calls from the next attempt onward.
 * - If the breaker store is unreachable, the breaker fails OPEN (the call
 *   proceeds) — the breaker protects availability, it must not compound
 *   a store outage into a total provider outage.
 */

export const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
} as const;

export type CircuitStateValue = (typeof CircuitState)[keyof typeof CircuitState];

export class CircuitBreakerOpenError extends Error {
  readonly service: string;
  readonly circuitState: CircuitStateValue;
  readonly retryAfterMs: number | null;

  constructor(
    service: string,
    retryAfterMs: number | null = null,
    message = `Circuit breaker is open for "${service}"`
  ) {
    super(message);
    this.name = "CircuitBreakerOpenError";
    this.service = service;
    this.circuitState = CircuitState.OPEN;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  readonly service: string;
  readonly failureThreshold: number;
  readonly cooldownMs: number;

  constructor(service: string, config: CircuitBreakerConfig = {}) {
    this.service = service;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.cooldownMs = config.cooldownMs ?? 30_000;
  }

  private get identifier(): string {
    return `circuit-breaker:${this.service}`;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let status: RateLimitResult;
    try {
      status = await checkRateLimit(
        this.identifier,
        this.failureThreshold,
        this.cooldownMs
      );
    } catch (storeError) {
      console.warn(
        JSON.stringify({
          event: "circuit_breaker_state_unavailable",
          service: this.service,
        }),
        storeError
      );
      return fn();
    }

    if (!status.allowed) {
      throw new CircuitBreakerOpenError(
        this.service,
        Math.max(1, status.resetAt - Date.now())
      );
    }

    try {
      const result = await fn();
      try {
        await clearRateLimit(this.identifier);
      } catch (storeError) {
        console.warn(
          JSON.stringify({
            event: "circuit_breaker_clear_failed",
            service: this.service,
          }),
          storeError
        );
      }
      return result;
    } catch (error) {
      try {
        await checkAndRecordRateLimit(
          this.identifier,
          this.failureThreshold,
          this.cooldownMs
        );
      } catch (storeError) {
        console.warn(
          JSON.stringify({
            event: "circuit_breaker_record_failed",
            service: this.service,
          }),
          storeError
        );
      }
      throw error;
    }
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  service: string,
  config?: CircuitBreakerConfig
): CircuitBreaker {
  if (!circuitBreakers.has(service)) {
    circuitBreakers.set(service, new CircuitBreaker(service, config));
  }
  return circuitBreakers.get(service)!;
}

/** Test-only: drop the cached handles. State lives in Postgres, so tests
 * that exercise real breaker semantics reset the store mock instead. */
export function resetAllCircuitBreakers(): void {
  circuitBreakers.clear();
}
