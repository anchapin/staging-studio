import { describe, expect, it } from "vitest";

import {
  dockerfileCmd,
  findDockerfileStage,
  parseDockerfileStages,
  stageCopySources,
  stagePrunesDevDependencies,
  stageRunCommands,
  stripDockerfileComments,
  unresolvableCopySources,
} from "@/lib/dockerfile-audit";

/**
 * Unit coverage for the pure Dockerfile parsing behind `tests/dockerfile.test.ts`
 * (issue #1157). Fixtures here are deliberately shaped like the real
 * Dockerfile's traps: comments around a COPY, options in front of the source,
 * a trailing slash, and an `AS` alias in mixed case.
 */

const MULTI_STAGE = `# leading comment
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm ci --ignore-scripts
# a comment that mentions COPY --from=builder /app/nope/ must be ignored
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS Runner
WORKDIR /app
COPY --from=builder --chown=nextjs:nextjs /app/.next/ ./.next/
COPY --from=builder --chown=nextjs:nextjs /app/public/ ./public/
COPY --from=builder --chown=nextjs:nextjs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nextjs /app/node_modules ./node_modules
CMD ["./node_modules/.bin/next", "start"]
`;

describe("stripDockerfileComments", () => {
  it("drops full-line comments and keeps the directives", () => {
    const stripped = stripDockerfileComments(MULTI_STAGE);
    expect(stripped).not.toContain("a comment that mentions COPY");
    expect(stripped).toContain("FROM node:22-slim AS builder");
  });

  it("keeps a `#` that is part of a line's content (it is a path, not a comment)", () => {
    // Docker has no inline-comment syntax, so trimming from the first `#`
    // would corrupt the directive.
    expect(stripDockerfileComments("RUN echo a#b")).toBe("RUN echo a#b");
  });
});

describe("parseDockerfileStages", () => {
  it("splits on FROM and lowercases the alias", () => {
    const stages = parseDockerfileStages(MULTI_STAGE);
    expect(stages.map((stage) => stage.name)).toEqual(["builder", "runner"]);
  });

  it("keeps each stage's own lines and nothing from its neighbour", () => {
    const [builder, runner] = parseDockerfileStages(MULTI_STAGE);
    expect(builder.body).toContain("npm prune --omit=dev");
    expect(builder.body).not.toContain("CMD");
    expect(runner.body).toContain("CMD");
    expect(runner.body).not.toContain("npm prune");
  });

  it("names an unnamed stage with an empty alias rather than dropping it", () => {
    const stages = parseDockerfileStages("FROM node:22-slim\nCMD [\"a\"]\n");
    expect(stages).toHaveLength(1);
    expect(stages[0].name).toBe("");
  });
});

describe("findDockerfileStage", () => {
  it("finds a stage case-insensitively", () => {
    expect(findDockerfileStage(MULTI_STAGE, "runner")).toContain("COPY --from=builder");
  });

  it("returns null for a stage that does not exist, so a rename fails an assertion not a throw", () => {
    expect(findDockerfileStage(MULTI_STAGE, "prod")).toBeNull();
  });
});

describe("stageCopySources", () => {
  it("normalises options, the /app prefix and a trailing slash", () => {
    const runner = findDockerfileStage(MULTI_STAGE, "runner")!;
    expect(stageCopySources(runner)).toEqual([
      ".next",
      "public",
      "package.json",
      "node_modules",
    ]);
  });

  it("ignores commented-out copies", () => {
    const runner = findDockerfileStage(MULTI_STAGE, "runner")!;
    expect(stageCopySources(runner)).not.toContain("nope");
  });

  it("returns nothing for a stage that copies from nowhere (the builder)", () => {
    expect(stageCopySources(findDockerfileStage(MULTI_STAGE, "builder")!)).toEqual([]);
  });

  it("can read a copy from a differently named stage", () => {
    const single = "FROM a AS first\nFROM b AS second\nCOPY --from=first /app/x/ ./x/\n";
    expect(stageCopySources(single, "first")).toEqual(["x"]);
  });
});

describe("stageRunCommands", () => {
  it("returns the command text without the RUN keyword", () => {
    const builder = findDockerfileStage(MULTI_STAGE, "builder")!;
    expect(stageRunCommands(builder)).toEqual([
      "npm ci --ignore-scripts",
      "npm run build",
      "npm prune --omit=dev",
    ]);
  });
});

describe("stagePrunesDevDependencies", () => {
  it("detects the prune that makes a copied node_modules a production one", () => {
    expect(stagePrunesDevDependencies(findDockerfileStage(MULTI_STAGE, "builder")!)).toBe(true);
  });

  it("is false for a stage that only installs dev dependencies", () => {
    const stage = "FROM node:22-slim AS builder\nRUN npm ci\n";
    expect(stagePrunesDevDependencies(stage)).toBe(false);
  });
});

describe("dockerfileCmd", () => {
  it("returns the shell form of the CMD", () => {
    expect(dockerfileCmd(MULTI_STAGE)).toBe('["./node_modules/.bin/next", "start"]');
  });

  it("returns null when there is no CMD", () => {
    expect(dockerfileCmd("FROM node:22-slim\nRUN true\n")).toBeNull();
  });

  it("ignores a CMD that only appears in a comment", () => {
    expect(dockerfileCmd("# CMD [\"npx\", \"next\", \"start\"]\nFROM node:22-slim\n")).toBeNull();
  });
});

describe("unresolvableCopySources", () => {
  it("reports only the paths that are neither repo files nor build artifacts", () => {
    // The caller's `existsSync` stands in for "is in the repo": here only
    // `package.json` and `prisma` are.
    const inRepo = new Set(["package.json", "prisma"]);
    const artifacts = new Set([".next", "node_modules"]);
    expect(unresolvableCopySources(MULTI_STAGE, artifacts).filter((p) => !inRepo.has(p))).toEqual([
      "public",
    ]);
  });

  it("reports nothing when every copied path is accounted for", () => {
    const inRepo = new Set(["public", "package.json"]);
    const artifacts = new Set([".next", "node_modules"]);
    expect(
      unresolvableCopySources(MULTI_STAGE, artifacts).filter((p) => !inRepo.has(p))
    ).toEqual([]);
  });

  it("de-duplicates a path copied by several stages", () => {
    const twoRunners = `${MULTI_STAGE}\nFROM node:22-slim AS sidemcar\nCOPY --from=builder /app/public/ ./public/\n`;
    expect(unresolvableCopySources(twoRunners, new Set())).toEqual([
      ".next",
      "public",
      "package.json",
      "node_modules",
    ]);
  });

  it("skips the `.` whole-context copy", () => {
    expect(unresolvableCopySources("FROM a AS x\nCOPY --from=builder /app/ ./\n", new Set())).toEqual([]);
  });
});
