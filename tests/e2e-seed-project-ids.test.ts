import { describe, it, expect } from "vitest";

import {
  E2E_CONCEPT_PROJECT_ID,
  E2E_EDITOR_PROJECT_ID,
  E2E_REHEARSAL_PROJECT_ID,
  E2E_SIGNOFF_PROJECT_ID,
  E2E_UPLOAD_PROJECT_ID,
} from "./e2e/env";
import { PROJECT_ID_PATTERN } from "@/lib/sign-project-schema";

/**
 * Issue #1079 — seeded e2e projectIds must match Prisma's cuid pattern.
 *
 * Background: every seeded Project row carries a FIXED id so the hermetic
 * Playwright suite can address it by URL (issue #165). Until #1079 the
 * constants used `e2e…`-prefixed nanoid-shaped ids; that shape was
 * rejected with a 400 by `/api/sign-project`, `/api/export-pdf`, and
 * `/api/v1/export-pdf` before any business logic ran, so tests could not
 * mint preview tokens for those projects nor exercise the ownership /
 * cuid-check code paths they cared about. The dedicated signoff project
 * (#695) had been cuid-shaped since its introduction; #1079 brought the
 * remaining seeds in line.
 *
 * This test pins the regression: any change that re-introduces a non-cuid
 * id for one of these constants will trip the test BEFORE the e2e suite
 * fails downstream with a confusing 400.
 */
describe("e2e seed projectIds (issue #1079)", () => {
  it("every E2E_*_PROJECT_ID constant matches the cuid pattern enforced by the API routes", () => {
    const seedIds = {
      E2E_UPLOAD_PROJECT_ID,
      E2E_EDITOR_PROJECT_ID,
      E2E_CONCEPT_PROJECT_ID,
      E2E_REHEARSAL_PROJECT_ID,
      E2E_SIGNOFF_PROJECT_ID,
    };
    for (const [name, id] of Object.entries(seedIds)) {
      expect(id, `${name}="${id}" must match /^c[a-z0-9]{24}$/`).toMatch(PROJECT_ID_PATTERN);
    }
  });

  it("the signoff seed predates #1079 and has stayed cuid-shaped across the migration", () => {
    // E2E_SIGNOFF_PROJECT_ID was made cuid-shaped in #695 — three commits
    // before #1079 broadened the convention. Pinning it explicitly guards
    // against a careless rewrite that drops the `c` prefix.
    expect(E2E_SIGNOFF_PROJECT_ID.startsWith("c")).toBe(true);
    expect(E2E_SIGNOFF_PROJECT_ID).toHaveLength(25);
  });
});