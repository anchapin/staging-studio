import { describe, expect, it } from "vitest";

import {
  shouldPersistResult,
  INPAINT_NOT_PERSISTED_WARNING,
  type InpaintCompletionPayload,
} from "@/lib/inpaint-completion";

describe("shouldPersistResult (issue #687 client guard)", () => {
  describe("persisted: false — expiring fal URL", () => {
    const decision = shouldPersistResult({
      imageUrl: "https://fal.media/flux/tmp/expiring.png",
      persisted: false,
    });

    it("blocks persistence (no room variant patch, no InpaintVersion row)", () => {
      expect(decision.persist).toBe(false);
      expect(decision.reason).toBe("not-persisted");
    });

    it("carries the warning copy the editor surfaces as a toast", () => {
      if (!decision.persist) {
        expect(decision.warning).toBe(INPAINT_NOT_PERSISTED_WARNING);
        expect(decision.warning.length).toBeGreaterThan(0);
      } else {
        throw new Error("expected a non-persist decision");
      }
    });
  });

  describe("persisted: true — durable storage URL", () => {
    it("allows the normal completion flow (room patch + version save)", () => {
      expect(
        shouldPersistResult({
          imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
          persisted: true,
        })
      ).toEqual({ persist: true, reason: "durable" });
    });
  });

  describe("persisted absent — legacy/default contract", () => {
    it("treats an absent flag as durable (normal completion flow)", () => {
      const payload: InpaintCompletionPayload = {
        imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
      };
      expect(shouldPersistResult(payload)).toEqual({ persist: true, reason: "durable" });
    });
  });

  describe("defensive parsing", () => {
    it("only an explicit false blocks persistence — junk values stay durable", () => {
      for (const persisted of [undefined, null, 0, "", "false", "no"]) {
        expect(shouldPersistResult({ persisted })).toEqual({
          persist: true,
          reason: "durable",
        });
      }
    });
  });
});
