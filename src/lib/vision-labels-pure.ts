/**
 * Pure (no DB) helpers for vision-label rendering. Split from
 * `vision-labels.ts` so client components (e.g. `useConceptDetection`,
 * `instance-overlays`) can import the pure functions without dragging the
 * `@prisma/client` + `@prisma/adapter-pg` + `pg` chain into the client
 * bundle. The DB-touching functions (`getCachedVisionLabels`,
 * `upsertVisionLabels`) stay in `vision-labels.ts` and are only imported
 * from server-side code (server actions, API routes).
 *
 * Side effects: none.
 */

/** Tight axis-aligned bounds of painted cells, in grid pixel space. */
export interface MaskBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Comma-join a list of member labels. De-dupes (case-sensitive, trimmed)
 * and preserves first-seen order; two labels join with "and"
 * ("sofa and coffee table"); three or more join as a list with a final
 * "and"; a single unique label stays singular ("chair" — a fused pair of
 * chairs is still just a chair). Empty/whitespace-only labels are dropped;
 * an all-empty input yields "" (the caller falls back to the concept
 * string). Deterministic.
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
 * call fails or omits an instance).
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

/**
 * Bounding box of the painted cells — the crop region the labeling flow
 * rasterizes per instance. Null for an empty mask or malformed geometry.
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

/**
 * DJB2-style base36 hash of an imageUrl for stable DB keys. Used to key
 * the persistent `VisionLabel` cache (see `vision-labels.ts` for the DB
 * side). Pure.
 */
export function hashImageUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) + hash ^ url.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

/**
 * The first painted cell scanning top-to-bottom, then left-to-right —
 * the badge anchor for a merged region (issue #252 D4: topmost-leftmost
 * pixel of the union mask). Null for an empty mask.
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
