/**
 * Pure mapping from the `?error=` query parameter (set by
 * `/auth/callback` on failed magic-link exchanges) to the human-readable
 * message the login page renders in its error banner.
 *
 * Contract: any non-empty value yields a message (unknown values get a
 * generic fallback, never `undefined`), and an absent/empty value yields
 * `null` so the caller can skip rendering the banner entirely.
 *
 * Side effects: none — pure function, no env vars or I/O.
 *
 * @param errorParam The raw `error` search-param value, if present.
 * @returns The banner text, or `null` when no error was signaled.
 */
export function resolveLoginErrorMessage(
  errorParam: string | null | undefined
): string | null {
  if (!errorParam) return null;

  const knownMessages: Record<string, string> = {
    auth_callback_failed:
      "We couldn't complete your sign-in. The link may have expired or already been used — please try again.",
  };

  return (
    knownMessages[errorParam] ??
    "Something went wrong while signing you in. Please try again."
  );
}
