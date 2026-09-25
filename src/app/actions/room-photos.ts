"use server";

import { createSupabaseRequestClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { withRetry } from "@/lib/retry";

const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/**
 * Which before-image slot an upload targets: `0` = primary
 * (`beforeImageUrl`), `1` = alternate (`beforeImageUrl2`).
 */
export type VariantSlot = 0 | 1;

/** Uniform failure shape returned by every action in this file. */
export type ActionFailure = { success: false; error: string };

function failure(error: string): ActionFailure {
  return { success: false, error };
}

function isVariantSlot(value: number): value is VariantSlot {
  return value === 0 || value === 1;
}

function storagePathForSlot(
  roomId: string,
  fileExt: string,
  variantSlot: VariantSlot
): string {
  const suffix = variantSlot === 1 ? "-2" : "";
  return `rooms/${roomId}/before-image${suffix}.${fileExt}`;
}

function slotColumn(variantSlot: VariantSlot): "beforeImageUrl" | "beforeImageUrl2" {
  return variantSlot === 1 ? "beforeImageUrl2" : "beforeImageUrl";
}

function storagePathMatchesSlot(
  roomId: string,
  storagePath: string,
  variantSlot: VariantSlot
): boolean {
  const escapedRoomId = roomId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = variantSlot === 1 ? "-2" : "";
  const pattern = new RegExp(
    `^rooms/${escapedRoomId}/before-image${suffix}\\.(jpg|jpeg|png|webp)$`
  );
  return pattern.test(storagePath);
}

/**
 * Server action (step 1 of 2): mints a short-lived signed upload URL for
 * a room's before-image.
 *
 * PURPOSE & CALL ORDER — this action is the first leg of a strict
 * three-step upload sequence:
 *
 *   1. `getSignedUploadUrl(roomId, fileName, variantSlot)` → returns
 *      `{ signedUrl, storagePath }`.
 *   2. The CLIENT uploads the raw file with an HTTP `PUT` to
 *      `signedUrl` (no cookies involved).
 *   3. `confirmRoomPhotoUpload(roomId, projectId, storagePath,
 *      variantSlot)` links the stored object into the `Room` row and
 *      revalidates the project page.
 *
 * Skipping step 3 leaves the object uploaded but the room unchanged.
 * The `storagePath` echoed back MUST be passed to step 3 unchanged —
 * `confirmRoomPhotoUpload` rejects paths that don't match the expected
 * `rooms/{roomId}/before-image[-2].{ext}` pattern for the slot.
 *
 * PREREQUISITE: a Supabase Storage bucket named `room-photos` must
 * exist (created in the Supabase dashboard/SQL); the signed-URL call
 * fails with an `ActionFailure` if it doesn't.
 *
 * Contract: `variantSlot` must be 0 or 1; the file extension (from
 * `fileName`) must be one of jpg, jpeg, png, webp; requires an
 * authenticated session whose Prisma user owns the room's project
 * (verified with an ownership-filtered `room.findFirst`).
 *
 * Side effects: needs `DATABASE_URL`, Supabase env vars, and a valid
 * session cookie; creates a signed upload URL in the `room-photos`
 * bucket with `upsert: true` (re-uploads overwrite the same object).
 * Nothing is written to Postgres here.
 *
 * @param roomId ID of the room the photo belongs to (scopes the object
 *   path and the ownership check).
 * @param fileName Original file name; only its extension is used.
 * @param variantSlot Target slot: `0` (primary) or `1` (alternate).
 * @returns `{ success: true, signedUrl, storagePath }` to feed steps 2
 *   and 3, or `ActionFailure` on invalid slot/extension, missing auth,
 *   unowned room, or a Storage/bucket error.
 */
export async function getSignedUploadUrl(
  roomId: string,
  fileName: string,
  variantSlot: number = 0
): Promise<
  | { success: true; signedUrl: string; storagePath: string }
  | ActionFailure
> {
  if (!isVariantSlot(variantSlot)) {
    return failure("Invalid variant slot: must be 0 or 1");
  }

  const fileExt = (fileName.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(fileExt)) {
    return failure(
      `Unsupported image extension: .${fileExt || "unknown"}. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`
    );
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const ownsRoom = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!ownsRoom) {
    return failure("Room not found or not owned by user");
  }

  const supabase = await createSupabaseRequestClient();

  const storagePath = storagePathForSlot(roomId, fileExt, variantSlot);

  const { data, error } = await withRetry(
    () =>
      supabase.storage
        .from("room-photos")
        .createSignedUploadUrl(storagePath, {
          upsert: true,
        }),
    2,
    500
  );

  if (error) {
    return failure(`Failed to get signed URL: ${error.message}`);
  }

  return { success: true, signedUrl: data.signedUrl, storagePath };
}

/**
 * Server action (step 3 of 3): links an uploaded before-image to the
 * room and refreshes the project page.
 *
 * PURPOSE & CALL ORDER — the final leg of the upload sequence: after
 * `getSignedUploadUrl` (step 1) and the client's raw HTTP `PUT` to the
 * signed URL (step 2), this action derives the object's public URL and
 * writes it to the room's slot column
 * (`beforeImageUrl` or `beforeImageUrl2`).
 *
 * PREREQUISITES: the `room-photos` storage bucket exists, and step 2
 * has actually completed — no existence check is performed on the
 * object, so confirming an incomplete PUT stores a public URL that
 * 404s.
 *
 * Contract: `variantSlot` must be 0 or 1; `storagePath` must be exactly
 * the value returned by `getSignedUploadUrl` for that slot (regex-
 * checked as `rooms/{roomId}/before-image[-2].{jpg|jpeg|png|webp}`,
 * roomId regex-escaped — tampered paths are rejected before any write).
 * Requires an authenticated session owning the room's project; the
 * Prisma update carries the same ownership filter. Failures are caught
 * and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL`, Supabase env vars, and a valid
 * session cookie; performs a Prisma `room.update`; calls
 * `revalidatePath(/projects/{projectId})` so the new image renders on
 * the next request.
 *
 * @param roomId ID of the room whose slot is being updated.
 * @param projectId Project page path to revalidate after the write.
 * @param storagePath Verbatim `storagePath` from `getSignedUploadUrl`.
 * @param variantSlot Target slot: `0` (primary) or `1` (alternate).
 * @returns `{ success: true, publicUrl }` (the Supabase public URL now
 *   stored on the room), or `ActionFailure` on invalid slot, path
 *   mismatch, missing auth, or a failed update.
 */
export async function confirmRoomPhotoUpload(
  roomId: string,
  projectId: string,
  storagePath: string,
  variantSlot: number = 0
): Promise<{ success: true; publicUrl: string } | ActionFailure> {
  if (!isVariantSlot(variantSlot)) {
    return failure("Invalid variant slot: must be 0 or 1");
  }

  if (!storagePathMatchesSlot(roomId, storagePath, variantSlot)) {
    return failure("Storage path does not match the expected path for this room and variant slot");
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const supabase = await createSupabaseRequestClient();

  const {
    data: { publicUrl },
  } = supabase.storage.from("room-photos").getPublicUrl(storagePath);

  try {
    await prisma.room.update({
      where: { id: roomId, project: { userId: user.id } },
      data: { [slotColumn(variantSlot)]: publicUrl },
    });
  } catch (error) {
    console.error("Failed to confirm room photo upload:", error);
    return failure(
      error instanceof Error ? error.message : "Failed to link uploaded photo to room"
    );
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true, publicUrl };
}
