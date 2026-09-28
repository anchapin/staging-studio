/**
 * Issue #1157: the Dockerfile could not build, and its runner stage could not
 * start the app.
 *
 * Two independent defects, both invisible to every other check in this repo:
 *
 *  1. `COPY --from=builder /app/public/ ./public/` — there is no `public/`
 *     in this project (App Router keeps assets in `src/app`), and Docker has
 *     no conditional COPY, so `docker build` failed outright with "no such
 *     file or directory".
 *  2. The runner stage copied `.next/`, `public/`, `package.json` and
 *     `prisma/` but NOT `node_modules`, and ended with
 *     `CMD ["npx", "next", "start"]`. With no local binary, `npx` downloads
 *     a floating `latest` from the registry at container boot, serving a
 *     Next.js version unrelated to the one that produced `.next/`.
 *
 * Nothing runs the image — Vercel builds from source, vitest never shells
 * out to Docker, and the Playwright harness starts `next start` directly — so
 * the file rotted for the life of the project. This test pins the FILE; the
 * `Docker image builds` CI job proves the IMAGE actually builds and boots.
 *
 * The general rule, which is what catches the next version of defect 1: every
 * path a stage copies out of an earlier stage must either be a build
 * artifact or actually exist in the repo. That is the whole class — a
 * `COPY` of a directory nobody created. The parsing lives in
 * `src/lib/dockerfile-audit.ts`; its own unit tests are in
 * `tests/dockerfile-audit.test.ts`.
 *
 * Each assertion below was verified by reinstating the defect it catches.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  dockerfileCmd,
  findDockerfileStage,
  parseDockerfileStages,
  stageCopySources,
  stagePrunesDevDependencies,
  unresolvableCopySources,
} from "@/lib/dockerfile-audit";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCKERFILE = path.join(REPO_ROOT, "Dockerfile");

const dockerfile = readFileSync(DOCKERFILE, "utf8");

/**
 * Paths a stage may copy that are NOT in the repo, because a `RUN` creates
 * them. Each entry says who makes it; an unlisted path must exist on disk or
 * the audit below fails.
 */
const BUILD_ARTIFACTS = [
  ".next", // `next build`
  "node_modules", // `npm ci` then `npm prune --omit=dev`
];

describe("Dockerfile (#1157)", () => {
  it("the audit is not vacuous — it parses real stages and real copies", () => {
    const stages = parseDockerfileStages(dockerfile);
    expect(stages.length, "expected a multi-stage Dockerfile").toBeGreaterThan(1);
    expect(stages.map((stage) => stage.name)).toContain("runner");
    // Checked on the runner, which is where both #1157 defects were; the
    // builder is the first stage and so copies out of nothing.
    expect(
      stageCopySources(findDockerfileStage(dockerfile, "runner") ?? "").length,
      "no COPY --from=builder found in the runner; the parser is broken"
    ).toBeGreaterThan(0);
  });

  it("every path copied out of a stage exists in the repo or is a build artifact", () => {
    const offenders = unresolvableCopySources(dockerfile, BUILD_ARTIFACTS).filter(
      (source) => !existsSync(path.join(REPO_ROOT, source))
    );

    expect(
      offenders,
      `The Dockerfile copies ${offenders.join(", ")} out of a stage, but that ` +
        `path does not exist in the repo and no build step creates it, so ` +
        `\`docker build\` fails with "no such file or directory" — the exact ` +
        `defect of #1157. Either commit the directory (an empty one plus a ` +
        `.gitkeep is fine; Docker has no conditional COPY) or drop the COPY. ` +
        `If a command genuinely creates the path, add it to BUILD_ARTIFACTS ` +
        `in this test with a note saying which.`
    ).toEqual([]);
  });

  it("the runner carries node_modules, so nothing resolves a binary off the registry", () => {
    const runner = findDockerfileStage(dockerfile, "runner") ?? "";

    expect(
      stageCopySources(runner),
      "the runner stage must copy node_modules from the builder; without it " +
        "the CMD has no local `next` to run (#1157)"
    ).toContain("node_modules");
  });

  it("the build output the server serves is copied into the runner", () => {
    expect(stageCopySources(findDockerfileStage(dockerfile, "runner") ?? "")).toContain(".next");
  });

  it("the CMD runs the LOCAL next binary, not `npx next`", () => {
    // `npx next` with no local install downloads a floating `latest` at
    // container boot, so a green build would still ship an unpinned server.
    const cmd = dockerfileCmd(dockerfile);

    expect(cmd, "no CMD found in the Dockerfile").not.toBeNull();
    expect(cmd).not.toMatch(/\bnpx\b/);
    expect(cmd).toMatch(/\.\/node_modules\/\.bin\/next\b/);
  });

  it("dev dependencies are pruned in the builder, so the copied tree is a production one", () => {
    // Without the prune the runner carries typescript, eslint and playwright,
    // and "the runner carries production node_modules" is unmet.
    expect(stagePrunesDevDependencies(findDockerfileStage(dockerfile, "builder") ?? "")).toBe(true);
  });
});
