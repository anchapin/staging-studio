import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitState,
  type CircuitStateValue,
  CircuitBreakerOpenError,
  CircuitBreaker,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from "@/lib/circuit-breaker";

describe("CircuitBreaker", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    resetAllCircuitBreakers();
  });

  describe("CircuitState enum", () => {
    it("has CLOSED, OPEN, and HALF_OPEN values", () => {
      expect(CircuitState.CLOSED).toBe("CLOSED");
      expect(CircuitState.OPEN).toBe("OPEN");
      expect(CircuitState.HALF_OPEN).toBe("HALF_OPEN");
    });

    it("CircuitStateValue type accepts all enum values", () => {
      const states: CircuitStateValue[] = [
        CircuitState.CLOSED,
        CircuitState.OPEN,
        CircuitState.HALF_OPEN,
      ];
      expect(states).toHaveLength(3);
    });
  });

  describe("CircuitBreakerOpenError", () => {
    it("creates error with service name", () => {
      const error = new CircuitBreakerOpenError("test-service");
      expect(error.service).toBe("test-service");
      expect(error.circuitState).toBe(CircuitState.OPEN);
      expect(error.retryAfterMs).toBeNull();
      expect(error.message).toBe('Circuit breaker is open for "test-service"');
      expect(error.name).toBe("CircuitBreakerOpenError");
    });

    it("creates error with custom retryAfterMs", () => {
      const error = new CircuitBreakerOpenError("test-service", 5000);
      expect(error.service).toBe("test-service");
      expect(error.retryAfterMs).toBe(5000);
    });

    it("creates error with custom message", () => {
      const error = new CircuitBreakerOpenError(
        "test-service",
        null,
        "Custom message"
      );
      expect(error.message).toBe("Custom message");
    });

    it("is instance of Error", () => {
      const error = new CircuitBreakerOpenError("test-service");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("CLOSED -> OPEN transition", () => {
    it("transitions to OPEN after failureThreshold failures", async () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }

      expect(cb.currentState).toBe(CircuitState.OPEN);
    });

    it("stays CLOSED when failures are below threshold", async () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      await expect(cb.execute(mockFn)).rejects.toThrow("fail");

      expect(cb.currentState).toBe(CircuitState.CLOSED);
    });

    it("resets failure count on success", async () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      dateNowSpy.mockReturnValue(1000);
      await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      dateNowSpy.mockReturnValue(2000);
      await cb.execute(mockFn);

      dateNowSpy.mockReturnValue(3000);
      const successFn = vi.fn().mockResolvedValue("ok");
      await cb.execute(successFn);

      dateNowSpy.mockReturnValue(4000);
      await cb.execute(successFn);
      await cb.execute(successFn);
      expect(cb.currentState).toBe(CircuitState.CLOSED);
    });
  });

  describe("OPEN -> HALF_OPEN transition", () => {
    it("transitions to HALF_OPEN after cooldownMs elapses", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(10_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);
    });

    it("stays OPEN while cooldownMs has not elapsed", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(4999);
      expect(cb.currentState).toBe(CircuitState.OPEN);
    });
  });

  describe("HALF_OPEN -> CLOSED on success", () => {
    it("transitions to CLOSED after successful half-open call", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
        halfOpenMaxCalls: 1,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(10_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

      dateNowSpy.mockReturnValue(10_001);
      const successFn = vi.fn().mockResolvedValue("success");
      await cb.execute(successFn);

      expect(cb.currentState).toBe(CircuitState.CLOSED);
    });

    it("handles halfOpenMaxCalls > 1 correctly", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
        halfOpenMaxCalls: 2,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(10_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

      const successFn = vi.fn().mockResolvedValue("success");
      dateNowSpy.mockReturnValue(10_001);
      await cb.execute(successFn);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

      dateNowSpy.mockReturnValue(10_002);
      await cb.execute(successFn);
      expect(cb.currentState).toBe(CircuitState.CLOSED);
    });
  });

  describe("HALF_OPEN -> OPEN on failure", () => {
    it("transitions back to OPEN on failure in half-open state", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
        halfOpenMaxCalls: 1,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(10_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

      dateNowSpy.mockReturnValue(10_001);
      await expect(cb.execute(mockFn)).rejects.toThrow("fail");

      expect(cb.currentState).toBe(CircuitState.OPEN);
    });
  });

  describe("execute() behavior", () => {
    it("throws CircuitBreakerOpenError when circuit is OPEN", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(5001);
      await expect(cb.execute(mockFn)).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("throws CircuitBreakerOpenError with retryAfterMs set", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      dateNowSpy.mockReturnValue(3000);
      try {
        await cb.execute(mockFn);
      } catch (e) {
        if (e instanceof CircuitBreakerOpenError) {
          expect(e.retryAfterMs).toBe(4000); // 5000 - (3000 - 2000) = 4000
        }
      }
    });

    it("returns result when circuit is CLOSED", async () => {
      const cb = new CircuitBreaker("test-service");
      const mockFn = vi.fn().mockResolvedValue("success");

      const result = await cb.execute(mockFn);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("rethrows original error when circuit is CLOSED", async () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });
      const mockFn = vi.fn().mockRejectedValue(new Error("original error"));

      await expect(cb.execute(mockFn)).rejects.toThrow("original error");
      await expect(cb.execute(mockFn)).rejects.toThrow("original error");
      expect(cb.currentState).toBe(CircuitState.CLOSED);
    });
  });

  describe("getStatus()", () => {
    it("returns correct state and failure count", () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });

      const status = cb.getStatus();
      expect(status.service).toBe("test-service");
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(0);
    });

    it("reflects failure count changes", async () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 3 });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      dateNowSpy.mockReturnValue(1000);
      await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      dateNowSpy.mockReturnValue(2000);
      await expect(cb.execute(mockFn)).rejects.toThrow("fail");

      const status = cb.getStatus();
      expect(status.failureCount).toBe(2);
      expect(status.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("reset()", () => {
    it("restores initial state", async () => {
      const cb = new CircuitBreaker("test-service", {
        failureThreshold: 3,
        cooldownMs: 5000,
      });
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      for (let i = 0; i < 3; i++) {
        dateNowSpy.mockReturnValue(i * 1000);
        await expect(cb.execute(mockFn)).rejects.toThrow("fail");
      }
      expect(cb.currentState).toBe(CircuitState.OPEN);

      cb.reset();

      expect(cb.currentState).toBe(CircuitState.CLOSED);
      const status = cb.getStatus();
      expect(status.failureCount).toBe(0);
    });
  });

  describe("singleton behavior", () => {
    it("returns same instance for same service", () => {
      const cb1 = getCircuitBreaker("test-service");
      const cb2 = getCircuitBreaker("test-service");

      expect(cb1).toBe(cb2);
    });

    it("returns different instances for different services", () => {
      const cb1 = getCircuitBreaker("service-a");
      const cb2 = getCircuitBreaker("service-b");

      expect(cb1).not.toBe(cb2);
    });

    it("subsequent calls return same instance with original config", () => {
      const cb1 = getCircuitBreaker("test-service");
      const cb2 = getCircuitBreaker("test-service");

      expect(cb1).toBe(cb2);
      expect(cb1.failureThreshold).toBe(3); // default
    });
  });

  describe("resetAllCircuitBreakers()", () => {
    it("resets all circuit breaker instances", async () => {
      const cb1 = getCircuitBreaker("service-a");
      const cb2 = getCircuitBreaker("service-b");
      const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

      dateNowSpy.mockReturnValue(1000);
      await expect(cb1.execute(mockFn)).rejects.toThrow("fail");
      await expect(cb1.execute(mockFn)).rejects.toThrow("fail");

      dateNowSpy.mockReturnValue(2000);
      await expect(cb2.execute(mockFn)).rejects.toThrow("fail");

      resetAllCircuitBreakers();

      expect(cb1.currentState).toBe(CircuitState.CLOSED);
      expect(cb2.currentState).toBe(CircuitState.CLOSED);
    });
  });

  describe("config options", () => {
    it("uses default failureThreshold of 3", () => {
      const cb = new CircuitBreaker("test-service");
      expect(cb.failureThreshold).toBe(3);
    });

    it("uses default cooldownMs of 30000", () => {
      const cb = new CircuitBreaker("test-service");
      expect(cb.cooldownMs).toBe(30_000);
    });

    it("uses default halfOpenMaxCalls of 1", () => {
      const cb = new CircuitBreaker("test-service");
      expect(cb.halfOpenMaxCalls).toBe(1);
    });

    it("respects custom failureThreshold", () => {
      const cb = new CircuitBreaker("test-service", { failureThreshold: 5 });
      expect(cb.failureThreshold).toBe(5);
    });

    it("respects custom cooldownMs", () => {
      const cb = new CircuitBreaker("test-service", { cooldownMs: 60_000 });
      expect(cb.cooldownMs).toBe(60_000);
    });

    it("respects custom halfOpenMaxCalls", () => {
      const cb = new CircuitBreaker("test-service", { halfOpenMaxCalls: 3 });
      expect(cb.halfOpenMaxCalls).toBe(3);
    });
  });
});
