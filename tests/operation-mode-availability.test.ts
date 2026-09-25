import { describe, expect, it } from "vitest";

import {
  COMING_SOON_BADGE,
  INPAINT_OPERATION_MODE_AVAILABILITY,
  INPAINT_OPERATION_MODE_IDS,
  isOperationModeAvailable,
} from "@/lib/operation-mode-availability";

describe("INPAINT_OPERATION_MODE_AVAILABILITY (issue #692)", () => {
  it("marks only Inpaint Zone as available", () => {
    expect(isOperationModeAvailable("inpaint-zone")).toBe(true);
  });

  it("marks Relight, Material Swap, and Restore Original as unavailable", () => {
    expect(isOperationModeAvailable("relight")).toBe(false);
    expect(isOperationModeAvailable("material-swap")).toBe(false);
    expect(isOperationModeAvailable("restore-original")).toBe(false);
  });

  it("covers every operation mode id exactly", () => {
    expect(new Set(Object.keys(INPAINT_OPERATION_MODE_AVAILABILITY))).toEqual(
      new Set(INPAINT_OPERATION_MODE_IDS)
    );
  });

  it("gives every unavailable mode non-empty coming-soon badge copy", () => {
    for (const id of INPAINT_OPERATION_MODE_IDS) {
      const entry = INPAINT_OPERATION_MODE_AVAILABILITY[id];
      if (!entry.available) {
        expect(entry.badge).toBeTruthy();
      }
    }
    expect(INPAINT_OPERATION_MODE_AVAILABILITY.relight.badge).toBe(
      COMING_SOON_BADGE
    );
  });

  it("fails closed for unknown mode ids", () => {
    expect(
      isOperationModeAvailable("relight-pro" as (typeof INPAINT_OPERATION_MODE_IDS)[number])
    ).toBe(false);
  });
});
