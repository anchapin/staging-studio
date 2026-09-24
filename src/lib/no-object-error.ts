/**
 * Describes fields from a NoObjectGeneratedError for structured logging.
 * Returns undefined if the error is not a NoObjectGeneratedError.
 */
export function describeNoObjectGeneratedError(
  error: unknown
): { finishReason?: string; text?: string } | undefined {
  if (error instanceof Error && "finishReason" in error) {
    const e = error as Error & { finishReason?: string };
    return {
      finishReason: e.finishReason,
      text: e.message,
    };
  }
  return undefined;
}
