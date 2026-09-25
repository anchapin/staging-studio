/**
 * Retry utility for transient operations with exponential backoff and jitter.
 *
 * Designed for rate-limited APIs (fal.ai FLUX.1 Fill, OpenAI GPT-4o-mini) where
 * fixed-delay backoff is suboptimal — it wastes time on operations that could succeed
 * sooner, and hammers rate-limited APIs without giving them time to recover.
 *
 * Algorithm:
 * ```
 * delay = min(maxDelay, baseDelay * 2^attempt + randomJitter)
 * ```
 *
 * - Base delay: 1000ms
 * - Max delay: 30000ms
 * - Jitter: ±500ms (random value in range [-500, +500])
 *
 * The jitter prevents thundering herd problems when multiple clients retry simultaneously.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('/api/data'),
 *   5,        // maxAttempts
 *   1000,     // baseDelayMs
 *   30000     // maxDelayMs
 * );
 * ```
 *
 * @param fn - The asynchronous function to retry.
 * @param maxAttempts - Maximum number of attempts (must be >= 1).
 * @param baseDelayMs - Base delay in milliseconds (default: 1000).
 * @param maxDelayMs - Maximum delay cap in milliseconds (default: 30000).
 * @returns The result of the function call.
 * @throws The last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        // Exponential backoff: baseDelay * 2^(attempt-1) + jitter
        // attempt=1 → delay = baseDelay * 2^0 = baseDelay (no backoff on first failure)
        // attempt=2 → delay = baseDelay * 2^1 = 2 * baseDelay
        // attempt=3 → delay = baseDelay * 2^2 = 4 * baseDelay
        // ... and so on, capped at maxDelayMs
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = (Math.random() - 0.5) * 1000; // ±500ms
        const delay = Math.min(maxDelayMs, exponentialDelay + jitter);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
