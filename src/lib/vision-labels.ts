/**
 * Vision-label DB cache (issue #266).
 *
 * The pure label helpers (join / resolve / mask-bounds / topmost-leftmost /
 * image-url-hash) live in `vision-labels-pure.ts` so client components
 * can import them without dragging the Prisma client into the browser
 * bundle. This file is server-only and re-exports the pure helpers
 * internally so the existing server-side callers (`api/label-instances`,
 * any future server action) keep a single import path.
 */
// Intentionally NOT `import "server-only"`: this file's module-eval pulls in
// `@prisma/client` (and transitively `@prisma/adapter-pg` + `pg` for v7) which
// is the entire reason client code imports the *pure* helpers from
// `vision-labels-pure.ts` directly. We rely on convention + the fact that
// every DB-touching export here (`getCachedVisionLabels`, `upsertVisionLabels`)
// obviously requires a server. Tests that import this file run in vitest
// under node, where the prisma module resolves fine.
import { prisma } from "@/lib/prisma";
import { hashImageUrl } from "@/lib/vision-labels-pure";

export {
  joinRegionLabels,
  resolveRegionLabel,
  maskBounds,
  topmostLeftmostPoint,
  hashImageUrl,
  type MaskBounds,
} from "@/lib/vision-labels-pure";

/**
 * Read cached vision labels for `(imageUrl, concept, instanceIndices)`,
 * scoped to the calling user. Returns whatever rows exist (possibly empty);
 * the cache is a hit-skip-billing optimization, not a guarantee.
 */
export async function getCachedVisionLabels(params: {
  imageUrl: string;
  concept: string;
  instanceIndices: number[];
  userId: string;
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

/**
 * Upsert a batch of vision labels for one (imageUrl, concept) tuple.
 * Uses `skipDuplicates: true` so the cache is idempotent across re-runs
 * of the same batch.
 */
export async function upsertVisionLabels(params: {
  imageUrl: string;
  concept: string;
  results: Array<{ instanceIndex: number; label: string; score?: number }>;
  userId: string;
  roomId?: string;
}) {
  const { imageUrl, concept, results, userId, roomId } = params;
  const imageUrlHash = hashImageUrl(imageUrl);
  await prisma.visionLabel.createMany({
    data: results.map((r) => ({
      imageUrlHash,
      concept,
      instanceIndex: r.instanceIndex,
      label: r.label,
      score: r.score,
      userId,
      roomId,
    })),
    skipDuplicates: true,
  });
}
