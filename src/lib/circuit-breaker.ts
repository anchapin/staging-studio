export const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
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
  halfOpenMaxCalls?: number;
}

interface CircuitBreakerState {
  state: CircuitStateValue;
  failureCount: number;
  lastFailureTime: number | null;
  halfOpenCalls: number;
}

export class CircuitBreaker {
  private _state: CircuitBreakerState = {
    state: CircuitState.CLOSED,
    failureCount: 0,
    lastFailureTime: null,
    halfOpenCalls: 0,
  };

  readonly service: string;
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly halfOpenMaxCalls: number;

  constructor(service: string, config: CircuitBreakerConfig = {}) {
    this.service = service;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.cooldownMs = config.cooldownMs ?? 30_000;
    this.halfOpenMaxCalls = config.halfOpenMaxCalls ?? 1;
  }

  private getCurrentState(): CircuitBreakerState {
    const s = this._state;
    if (s.state === CircuitState.OPEN && s.lastFailureTime !== null) {
      const now = Date.now();
      if (now - s.lastFailureTime >= this.cooldownMs) {
        return {
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          lastFailureTime: s.lastFailureTime,
          halfOpenCalls: 0,
        };
      }
    }
    return s;
  }

  private transition(next: CircuitBreakerState): void {
    this._state = next;
  }

  get currentState(): CircuitStateValue {
    return this.getCurrentState().state;
  }

  private computeNextState(
    current: CircuitBreakerState,
    shouldFail: boolean
  ): CircuitBreakerState {
    if (!shouldFail) {
      if (current.state === CircuitState.HALF_OPEN) {
        const newHalfOpenCalls = current.halfOpenCalls + 1;
        if (newHalfOpenCalls >= this.halfOpenMaxCalls) {
          return {
            state: CircuitState.CLOSED,
            failureCount: 0,
            lastFailureTime: null,
            halfOpenCalls: 0,
          };
        }
        return {
          ...current,
          halfOpenCalls: newHalfOpenCalls,
        };
      }
      return {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: null,
        halfOpenCalls: 0,
      };
    }

    const newFailureCount = current.failureCount + 1;
    const now = Date.now();

    if (
      current.state === CircuitState.HALF_OPEN ||
      newFailureCount >= this.failureThreshold
    ) {
      return {
        state: CircuitState.OPEN,
        failureCount: newFailureCount,
        lastFailureTime: now,
        halfOpenCalls: 0,
      };
    }

    return {
      ...current,
      failureCount: newFailureCount,
      lastFailureTime: now,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.getCurrentState();

    if (current.state === CircuitState.OPEN) {
      if (
        current.lastFailureTime !== null &&
        Date.now() - current.lastFailureTime < this.cooldownMs
      ) {
        throw new CircuitBreakerOpenError(
          this.service,
          this.cooldownMs - (Date.now() - current.lastFailureTime)
        );
      }
      this.transition({
        state: CircuitState.HALF_OPEN,
        failureCount: 0,
        lastFailureTime: current.lastFailureTime,
        halfOpenCalls: 0,
      });
    }

    try {
      const result = await fn();
      this.transition(this.computeNextState(this.getCurrentState(), false));
      return result;
    } catch (error) {
      this.transition(this.computeNextState(this.getCurrentState(), true));
      if (this.getCurrentState().state === CircuitState.OPEN) {
        throw new CircuitBreakerOpenError(
          this.service,
          this.cooldownMs,
          `Circuit breaker opened for "${this.service}" after consecutive failures`
        );
      }
      throw error;
    }
  }

  reset(): void {
    this._state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastFailureTime: null,
      halfOpenCalls: 0,
    };
  }

  getStatus(): { service: string; state: CircuitStateValue; failureCount: number } {
    const s = this.getCurrentState();
    return {
      service: this.service,
      state: s.state,
      failureCount: s.failureCount,
    };
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

export function resetAllCircuitBreakers(): void {
  circuitBreakers.forEach((cb) => cb.reset());
}
