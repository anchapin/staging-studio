const ENV_VAR_DOCS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "Supabase dashboard → Settings/API → Project URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Supabase dashboard → Settings/API → anon public key",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase dashboard → Settings/API → service_role key",
  DATABASE_URL: "Supabase dashboard → Settings/API → database connection string",
  OPENAI_API_KEY: "platform.openai.com → API keys",
  FAL_KEY: "fal.ai dashboard → API keys",
  BROWSERLESS_API_KEY: "browserless.io → account API key",
};

export class MissingEnvVarsError extends Error {
  readonly missingVars: string[];

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
