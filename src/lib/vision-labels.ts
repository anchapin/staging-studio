/**
 * Vision-label resolution for the batch staging editor (issue #252 D4).
 *
 * After a billed detection, one batched GPT-4o-mini vision request names
 * every detected instance ("accent chair", "coffee table", …). Those
 * labels feed row headers, prompt pre-fill, and region labels. This
 * module owns the pure label math: how a merged region's label derives
 * from its members' labels, and when the detection concept stands in.
 *
 * Side effects: none (pure string logic).
 */

/**
 * Joins member labels into one region label: unique labels in first-seen
 * order, trimmed; two labels join with "and" ("sofa and coffee table");
 * three or more join as a list with a final "and"; a single unique label
 * stays singular ("chair" — a fused pair of chairs is still just a chair).
 * Empty/whitespace-only labels are dropped; an all-empty input yields ""
 * (the caller falls back to the concept string). Deterministic.
 * Side effects: none (pure).
 */
export function joinRegionLabels(labels: Array<string | null | undefined>): string {
  const unique: string[] = [];
  for (const label of labels) {
    const trimmed = label?.trim() ?? "";
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed);
  }
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

/**
 * A region's user-facing label: the joined vision labels of its members
 * when any exist, otherwise the detection concept (the fallback that rows
 * render with until vision labels arrive — and permanently when the vision
 * call fails or omits an instance). Side effects: none (pure).
 */
export function resolveRegionLabel(
  memberLabels: Array<string | null | undefined>,
  concept: string
): string {
  const joined = joinRegionLabels(memberLabels);
  if (joined) return joined;
  const fallback = concept.trim();
  return fallback;
}

/** Tight axis-aligned bounds of painted cells, in grid pixel space. */
export interface MaskBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box of the painted cells — the crop region the labeling flow
 * rasterizes per instance. Null for an empty mask or malformed geometry.
 * Side effects: none (pure).
 */
export function maskBounds(
  grid: Uint8Array,
  width: number,
  height: number
): MaskBounds | null {
  if (width <= 0 || height <= 0) return null;
  const total = width * height;
  if (grid.length < total) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < total; i++) {
    if (grid[i] !== 1) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX === -1) return null;
  return { minX, minY, maxX, maxY };
}

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Issue #266: persistent vision-label cache so re-opening the editor skips billing
// ---------------------------------------------------------------------------

/** DJB2-style base36 hash of an imageUrl for stable DB keys */
export function hashImageUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) + hash ^ url.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

export async function getCachedVisionLabels(params: {
  imageUrl: string;
  concept: string;
  instanceIndices: number[];
  userId?: string;
}) {
  const { imageUrl, concept, instanceIndices, userId } = params;
  const imageUrlHash = hashImageUrl(imageUrl);
  const labels = await prisma.visionLabel.findMany({
    where: {
      imageUrlHash,
      concept,
      instanceIndex: { in: instanceIndices },
      userId,
    },
  });
  return labels;
}

export async function upsertVisionLabels(params: {
  imageUrl: string;
  concept: string;
  results: Array<{ instanceIndex: number; label: string; score?: number }>;
  userId?: string;
}) {
  const { imageUrl, concept, results, userId } = params;
  const imageUrlHash = hashImageUrl(imageUrl);
  await prisma.visionLabel.createMany({
    data: results.map((r) => ({
      imageUrlHash,
      concept,
      instanceIndex: r.instanceIndex,
      label: r.label,
      score: r.score,
      userId,
    })),
    skipDuplicates: true,
  });
}

/**
 * The first painted cell scanning top-to-bottom, then left-to-right —
 * the badge anchor for a merged region (issue #252 D4: topmost-leftmost
 * pixel of the union mask). Null for an empty mask. Side effects: none.
 */
export function topmostLeftmostPoint(
  grid: Uint8Array,
  width: number,
  height: number
): { x: number; y: number } | null {
  const total = width * height;
  if (width <= 0 || height <= 0 || grid.length < total) return null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] === 1) return { x, y };
    }
  }
  return null;
}
