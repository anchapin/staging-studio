/**
 * Issue #1468 — the concept-submit detection flow.
 *
 * Pins `detectConceptObjects` (the function EditRoomStudio's
 * onConceptSubmit handler calls) against a MOCKED fetch: no live
 * (paid) /api/segment/furnishings call anywhere. The decode step is
 * injected so the test supplies binary grids directly instead of
 * decoding PNG data URLs in jsdom.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DETECTION_FAILED_MESSAGE,
  SEGMENT_FURNISHINGS_ENDPOINT,
  detectConceptObjects,
  detectionEmptyMessage,
} from "@/components/edit-room/EditRoomStudio";
import type { DecodedInstance } from "@/lib/detection-boxes";

function gridWithRect(): DecodedInstance {
  // 10x10 grid, painted rectangle x=2..4, y=3..5 -> box 20,30,30,30 (%)
  const grid = new Uint8Array(100);
  for (let y = 3; y <= 5; y++) for (let x = 2; x <= 4; x++) grid[y * 10 + x] = 1;
  return { grid, width: 10, height: 10 };
}

describe("detectConceptObjects (issue #1468)", () => {
  it("POSTs to /api/segment/furnishings and maps masks to detections", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        concept: "sofa",
        maskDataUrls: ["data:image/png;base64,AAAA"],
        scores: [0.9],
      }),
    })) as unknown as typeof fetch;

    const outcome = await detectConceptObjects({
      roomId: "room-1",
      imageUrl: "https://example.supabase.co/photo.jpg",
      concept: "sofa",
      fetchImpl,
      decode: async () => [gridWithRect()],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      SEGMENT_FURNISHINGS_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roomId: "room-1",
          imageUrl: "https://example.supabase.co/photo.jpg",
          concept: "sofa",
        }),
      })
    );
    expect(SEGMENT_FURNISHINGS_ENDPOINT).toBe("/api/segment/furnishings");
    expect(outcome.error).toBeNull();
    expect(outcome.detections).toEqual([
      { id: "sofa:0", concept: "sofa", label: "sofa", box: { x: 20, y: 30, w: 30, h: 30 } },
    ]);
  });

  it("a failed response yields an empty list, never the old fake boxes", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const outcome = await detectConceptObjects({
      roomId: "room-1",
      imageUrl: "https://example.supabase.co/photo.jpg",
      concept: "sofa",
      fetchImpl,
      decode: async () => [gridWithRect()],
    });

    expect(outcome.detections).toEqual([]);
    expect(outcome.error).toBe(DETECTION_FAILED_MESSAGE);
  });

  it("an empty mask list yields an empty list with the empty-concept message", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ concept: "rug", maskDataUrls: [], scores: [] }),
    })) as unknown as typeof fetch;

    const outcome = await detectConceptObjects({
      roomId: "room-1",
      imageUrl: "https://example.supabase.co/photo.jpg",
      concept: "rug",
      fetchImpl,
      decode: async () => [],
    });

    expect(outcome.detections).toEqual([]);
    expect(outcome.error).toBe(detectionEmptyMessage("rug"));
  });
});
