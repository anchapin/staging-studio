const ENV_VAR_DOCS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "Supabase dashboard → Settings/API → Project URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Supabase dashboard → Settings/API → anon public key",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase dashboard → Settings/API → service_role key",
  DATABASE_URL: "Supabase dashboard → Settings/API → database connection string",
  OPENAI_API_KEY: "platform.openai.com → API keys",
  FAL_KEY: "fal.ai dashboard → API keys",
  BROWSERLESS_API_KEY: "browserless.io → account API key",
};

/**
 * Error thrown by `requireEnvVars` when required variables are missing.
 *
 * Purpose: turns silent misconfiguration into an actionable failure. The
 * message lists every missing variable with a pointer to where the value
 * comes from (see `ENV_VAR_DOCS`), plus the `cp .env.example .env.local`
 * fix instructions.
 */
export class MissingEnvVarsError extends Error {
  /** Names of the env vars that were missing or blank. */
  readonly missingVars: string[];

  /**
   * @param missingVars Env var names that failed the presence check; each
   *   becomes a bullet in the error message. Unknown names fall back to
   *   "see .env.example".
   */
  constructor(missingVars: string[]) {
    const lines = missingVars.map((name) => {
      const where = ENV_VAR_DOCS[name] ?? "see .env.example";
      return `  - ${name} (${where})`;
    });
    super(
      [
        "Missing required environment variables:",
        ...lines,
        "",
        "To fix: cp .env.example .env.local, fill in the values, and restart the dev server.",
      ].join("\n")
    );
    this.name = "MissingEnvVarsError";
    this.missingVars = missingVars;
  }
}

/**
 * Validates that required environment variables are present, at call time.
 *
 * Purpose: gate external providers (Supabase, OpenAI, fal.ai, …) at the
 * point of use rather than at import, so a missing key fails with a
 * clear `MissingEnvVarsError` instead of an opaque provider error later.
 *
 * Contract: a variable counts as missing when it is `undefined` or
 * whitespace-only — empty-ish values are rejected, not passed through.
 *
 * Side effects: reads `process.env` only; throws when anything is
 * missing.
 *
 * @param names Env var names to require (e.g. `"FAL_KEY"`).
 * @returns A `{ [name]: value }` record of the resolved, non-empty
 *   values, so callers avoid re-reading `process.env`.
 */
export function requireEnvVars(...names: string[]): Record<string, string> {
  const missing = names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) throw new MissingEnvVarsError(missing);
  const resolved: Record<string, string> = {};
  for (const name of names) resolved[name] = process.env[name] as string;
  return resolved;
}
