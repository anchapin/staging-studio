export interface BackoffOptions {
  intervalMs: number;
  maxIntervalMs: number;
}

export interface BackoffState {
  delayMs: number;
}

export function createBackoff(options: BackoffOptions): BackoffState {
  return { delayMs: options.intervalMs };
}

export function jitter(delayMs: number): number {
  return delayMs * (0.5 + Math.random() * 0.5);
}

export function nextDelay(state: BackoffState, options: BackoffOptions): number {
  const nextRaw = Math.min(state.delayMs * 2, options.maxIntervalMs);
  state.delayMs = nextRaw;
  return Math.min(jitter(nextRaw), options.maxIntervalMs);
}
