import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Issue #1225: every server action that mutates lookbook-rendered data must
// revalidate the cookie-less print page /preview/{projectId} alongside its
// dashboard path. This pins the contract statically: any file under
// src/app/actions/ that revalidates a /projects/... path must also revalidate
// a /preview/... path.

const ACTIONS_DIR = join(__dirname, "..", "src", "app", "actions");

// Files allowed to revalidate /projects/... without /preview/...:
// - settings.ts: revalidates /settings, not project-scoped
// - setup.ts: demo-only provisioning, never touches a lookbook
const WHITELIST = new Set(["settings.ts", "setup.ts"]);

describe("preview revalidation contract (issue #1225)", () => {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));

  it("every action file revalidating /projects/... also revalidates /preview/...", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(ACTIONS_DIR, file), "utf8");
      const revalidatesProjects = /revalidatePath\(`\/projects\//.test(text);
      const revalidatesPreview = /revalidatePath\(`\/preview\//.test(text);
      if (WHITELIST.has(file)) continue;
      if (revalidatesProjects && !revalidatesPreview) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `lookbook-rendered mutations missing a /preview/{projectId} revalidatePath: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no action file revalidates /preview/... without also touching /projects/...", () => {
    // Sanity: a /preview revalidation only makes sense next to a project path.
    for (const file of files) {
      const text = readFileSync(join(ACTIONS_DIR, file), "utf8");
      if (/revalidatePath\(`\/preview\//.test(text)) {
        expect(
          /revalidatePath\(`\/projects\//.test(text),
          `${file} revalidates /preview/ without /projects/`,
        ).toBe(true);
      }
    }
  });
});
