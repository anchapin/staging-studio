/**
 * Pure parsing helpers for auditing a multi-stage `Dockerfile` (issue #1157).
 *
 * Extracted from `tests/dockerfile.test.ts` so the parsing is testable on
 * its own and the repo-specific test imports a production module rather
 * than reaching for `node:fs` alone — the rule the #693 tautology guard
 * enforces. Nothing in the app imports this; it exists to be audited by.
 *
 * The rule it exists to enforce: a stage that copies a path out of an
 * earlier stage needs that path to exist, either in the repo or because an
 * earlier `RUN` created it. Docker has no conditional `COPY` and no check,
 * so a path nobody creates fails the whole build — which is precisely how
 * `COPY --from=builder /app/public/ ./public/` rotted unnoticed in this
 * project for the life of the file.
 */

/** One `FROM … AS <name>` stage: its header plus every line up to the next. */
export interface DockerfileStage {
  /** The `AS <name>` alias, lowercased. `""` for an unnamed final stage. */
  name: string;
  /** The stage's lines, header included, comments already stripped. */
  body: string;
}

/**
 * Drops whole-line `#` comments.
 *
 * Only full-line comments: Docker has no inline-comment syntax, and a `#`
 * after a `COPY` is part of a path, so anything subtler would corrupt the
 * directives we parse. Blank lines are kept so error messages can quote a
 * line verbatim.
 */
export function stripDockerfileComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/** Splits a Dockerfile into its stages, keyed by the `AS` alias. */
export function parseDockerfileStages(source: string): DockerfileStage[] {
  const withoutComments = stripDockerfileComments(source);
  return withoutComments
    .split(/(?=^FROM\s)/m)
    .map((body) => body.trim())
    .filter((body) => body.length > 0)
    .map((body) => {
      const header = body.split("\n", 1)[0];
      const alias = /\bAS\s+(\S+)\s*$/i.exec(header)?.[1] ?? "";
      return { name: alias.toLowerCase(), body };
    });
}

/**
 * The body of the stage aliased `name`, or `null` when there is no such
 * stage. Callers get `null` rather than a throw so a renamed stage fails an
 * assertion with a readable message instead of an exception.
 */
export function findDockerfileStage(source: string, name: string): string | null {
  const target = name.toLowerCase();
  return parseDockerfileStages(source).find((stage) => stage.name === target)?.body ?? null;
}

/**
 * The `RUN` command lines in a stage body, verbatim.
 *
 * Used to tell "a command creates this" from "nothing creates this" — the
 * distinction `unresolvableCopySources` needs to judge a build artifact.
 */
export function stageRunCommands(stageBody: string): string[] {
  return stageBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^RUN\s/i.test(line))
    .map((line) => line.replace(/^RUN\s+/i, ""));
}

/**
 * Paths a stage copies out of `fromStage`, normalised for comparison:
 * `/app/public/` → `public`, `/app/package.json` → `package.json`. Options
 * (`--chown=…`, `--from=…`) are consumed, not reported.
 */
export function stageCopySources(stageBody: string, fromStage = "builder"): string[] {
  const pattern = new RegExp(
    `^COPY\\s+(?:-{1,2}\\S+\\s+)*--from=${fromStage}\\s+(?:--\\S+\\s+)*(\\S+)`,
    "gim"
  );
  const sources: string[] = [];
  for (const match of stageBody.matchAll(pattern)) {
    const normalized = match[1].replace(/^\/app\//, "").replace(/\/+$/, "");
    if (normalized) sources.push(normalized);
  }
  return sources;
}

/** The shell form of the image's `CMD`, or `null` when it has none. */
export function dockerfileCmd(source: string): string | null {
  const match = /^CMD\s+(.+)$/m.exec(stripDockerfileComments(source));
  return match ? match[1].trim() : null;
}

/** True when the stage drops dev dependencies (`npm prune --omit=dev`). */
export function stagePrunesDevDependencies(stageBody: string): boolean {
  return stageRunCommands(stageBody).some((command) =>
    /\bnpm\s+prune\b.*--omit=dev\b/.test(command)
  );
}

/**
 * The rule: every path copied out of an earlier stage must either be listed
 * in `buildArtifacts` (something a `RUN` creates, so it is absent from the
 * repo by design) or exist in the repo. Returns the offenders, in
 * Dockerfile order and de-duplicated, so the caller can name them.
 *
 * Pure: existence is the caller's business, which is what keeps this
 * testable without a filesystem.
 */
export function unresolvableCopySources(
  source: string,
  buildArtifacts: Iterable<string>
): string[] {
  const artifacts = new Set(buildArtifacts);
  const offenders = new Set<string>();

  for (const stage of parseDockerfileStages(source)) {
    for (const copied of stageCopySources(stage.body)) {
      if (copied === "." || artifacts.has(copied)) continue;
      offenders.add(copied);
    }
  }

  return [...offenders];
}
