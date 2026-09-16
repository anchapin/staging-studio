"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";

export async function saveProjectMetadata(
  projectId: string,
  metadata: {
    propertyAddress?: string;
    clientName?: string;
    targetBuyer?: string;
    stagingAesthetic?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await prisma.project.update({
      where: { id: projectId, userId: user.id },
      data: metadata,
    });
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save project metadata:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
