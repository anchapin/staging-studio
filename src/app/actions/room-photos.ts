"use server";

import { createServerClient } from "@supabase/ssr";
import { revalidatePath } from "next/cache";

export async function getSignedUploadUrl(
  roomId: string,
  fileName: string
) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Not authenticated");
  }

  const fileExt = fileName.split(".").pop() || "jpg";
  const storagePath = `rooms/${roomId}/before-image.${fileExt}`;

  const { data, error } = await supabase.storage
    .from("room-photos")
    .createSignedUploadUrl(storagePath, {
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to get signed URL: ${error.message}`);
  }

  return { signedUrl: data.signedUrl, storagePath };
}

export async function confirmRoomPhotoUpload(
  roomId: string,
  projectId: string,
  storagePath: string
) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Not authenticated");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("room-photos").getPublicUrl(storagePath);

  const { error } = await supabase
    .from("Room")
    .update({ beforeImageUrl: publicUrl })
    .eq("id", roomId);

  if (error) {
    throw new Error(`Failed to update room: ${error.message}`);
  }

  revalidatePath(`/projects/${projectId}`);
  return { publicUrl };
}
