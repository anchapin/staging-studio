"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { createSupabaseRequestClient } from "@/lib/supabase";

const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function isAllowedExtension(ext: string): boolean {
  return ALLOWED_IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}

const ROOM_TYPE_SYSTEM_PROMPT = `You are an expert interior design assistant. Given a room photo, identify the room type from this list:
- Primary Bedroom
- Secondary Bedroom
- Living Room
- Dining Room
- Kitchen
- Bathroom
- Home Office
- Garage
- Outdoor/Patio
- Other

Respond with ONLY the room type name. If uncertain, respond with the most likely option.`;

async function detectRoomType(imageDataUrl: string): Promise<string> {
  const { generateObject } = await import("ai");
  const { aiModel, assertOpenAIConfigured } = await import("@/lib/ai");

  assertOpenAIConfigured();

  const { object } = await generateObject({
    model: aiModel,
    schema: z.object({ roomType: z.string() }),
    messages: [
      { role: "system", content: ROOM_TYPE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text" as const, text: "What type of room is shown in this photo?" },
          { type: "image" as const, image: imageDataUrl },
        ],
      },
    ],
  });

  return object.roomType ?? "Other";
}

export interface BatchRoomEntry {
  fileName: string;
  roomType: string;
  beforeImageUrl: string;
}

export interface CreateRoomsResult {
  success: boolean;
  rooms?: Array<{
    id: string;
    name: string;
    beforeImageUrl: string | null;
  }>;
  error?: string;
}

export async function createRoomsBatch(
  projectId: string,
  entries: BatchRoomEntry[],
  roomNames?: string[]
): Promise<CreateRoomsResult> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { success: false, error: "No rooms provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: { id: true, rooms: { select: { id: true, sortOrder: true }, orderBy: { sortOrder: "desc" }, take: 1 } },
  });
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const maxSortOrder = project.rooms[0]?.sortOrder ?? -1;

  try {
    const rooms = await prisma.$transaction(
      entries.map((entry, index) =>
        prisma.room.create({
          data: {
            projectId,
            name: roomNames?.[index] ?? entry.roomType,
            beforeImageUrl: entry.beforeImageUrl,
            sortOrder: maxSortOrder + 1 + index,
          },
          select: { id: true, name: true, beforeImageUrl: true },
        })
      )
    );

    revalidatePath(`/projects/${projectId}`);
    return { success: true, rooms };
  } catch (error) {
    console.error("Failed to create rooms batch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getBatchRoomUploadUrls(
  projectId: string,
  files: Array<{ name: string }>
): Promise<
  | { success: true; uploads: Array<{ signedUrl: string; storagePath: string; roomIndex: number }> }
  | { success: false; error: string }
> {
  if (!Array.isArray(files) || files.length === 0) {
    return { success: false, error: "No files provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const supabase = await createSupabaseRequestClient();

  const uploads: Array<{ signedUrl: string; storagePath: string; roomIndex: number }> = [];

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i].name;
    const fileExt = (fileName.split(".").pop() || "").toLowerCase();
    if (!isAllowedExtension(fileExt)) {
      return {
        success: false,
        error: `Unsupported file extension: .${fileExt}. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`,
      };
    }

    const roomIndex = i;
    const storagePath = `batch-rooms/${projectId}/room-${roomIndex}-${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from("room-photos")
      .createSignedUploadUrl(storagePath, { upsert: true });

    if (error) {
      return { success: false, error: `Failed to get signed URL: ${error.message}` };
    }

    uploads.push({ signedUrl: data.signedUrl, storagePath, roomIndex });
  }

  return { success: true, uploads };
}

export async function detectBatchRoomTypes(
  imageUrls: string[]
): Promise<{ success: true; roomTypes: string[] } | { success: false; error: string }> {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return { success: false, error: "No images provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const roomTypes = await Promise.all(
      imageUrls.map(async (url) => {
        try {
          return await detectRoomType(url);
        } catch {
          return "Other";
        }
      })
    );

    return { success: true, roomTypes };
  } catch (error) {
    console.error("Batch room type detection failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Detection failed",
    };
  }
}
