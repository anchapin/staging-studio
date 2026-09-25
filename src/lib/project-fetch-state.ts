/**
 * Maps the outcome of a project fetch to which UI state the project detail
 * and lookbook preview pages must render (issue #90).
 *
 * Only an authoritative 404 means the project does not exist (or is not
 * visible to this user). Every other outcome — auth failures, server
 * errors, and thrown network errors (no status at all) — is a load
 * failure the user can retry, never data loss.
 *
 * `status` is the HTTP status code of the response, or null/undefined when
 * the fetch threw before a response existed (dropped connection, DNS
 * failure, offline browser).
 */
export type ProjectFetchState = "not-found" | "retryable";

export function projectFetchStateFromStatus(
  status: number | null | undefined
): ProjectFetchState {
  return status === 404 ? "not-found" : "retryable";
}
