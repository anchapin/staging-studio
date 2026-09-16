"use server";

import { createSupabaseRequestClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";

const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export type VariantSlot = 0 | 1;

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

  const { data, error } = await supabase.storage
    .from("room-photos")
    .createSignedUploadUrl(storagePath, {
      upsert: true,
    });

  if (error) {
    return failure(`Failed to get signed URL: ${error.message}`);
  }

  return { success: true, signedUrl: data.signedUrl, storagePath };
}

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
