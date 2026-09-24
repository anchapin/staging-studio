import { describe, expect, it } from "vitest";

import {
  decideInpaintPersistence,
  type InpaintPersistenceState,
} from "@/lib/inpaint-persistence";

const STORED_URL =
  "https://example.supabase.co/storage/v1/object/public/staging-images/after-req-1.png";

describe("decideInpaintPersistence", () => {
  it("returns the stored url for a COMPLETED row with a resultUrl", () => {
    const state: InpaintPersistenceState = {
      status: "COMPLETED",
      resultUrl: STORED_URL,
    };

    expect(decideInpaintPersistence(state)).toEqual({
      kind: "return-stored",
      url: STORED_URL,
    });
  });

  it("persists when the row is COMPLETED but resultUrl is null", () => {
    expect(decideInpaintPersistence({ status: "COMPLETED", resultUrl: null })).toEqual({
      kind: "persist",
    });
  });

  it("persists when the row is COMPLETED but resultUrl is an empty string", () => {
    expect(decideInpaintPersistence({ status: "COMPLETED", resultUrl: "" })).toEqual({
      kind: "persist",
    });
  });

  it.each(["IN_QUEUE", "IN_PROGRESS", "ERROR"])(
    "persists when the row status is %s even if a resultUrl exists",
    (status) => {
      expect(decideInpaintPersistence({ status, resultUrl: STORED_URL })).toEqual({
        kind: "persist",
      });
    }
  );
});
