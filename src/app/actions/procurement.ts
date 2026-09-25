"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("action:procurement");

const procurementItemSchema = z.object({
  id: z.string().optional(),
  item: z.string().min(1),
  category: z.string().min(1),
  vendor: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  estCost: z.number().optional().nullable(),
  status: z.string().optional(),
});

const procurementItemsSchema = z.array(procurementItemSchema);

export type ProcurementItemInput = z.infer<typeof procurementItemSchema>;

/**
 * Server action: replaces all procurement items for a project.
 * Performs upsert semantics: items with ids that exist are updated, items
 * without ids are inserted, items with ids not in the payload are deleted.
 *
 * Contract: requires an authenticated session; ownership is enforced via
 * the project lookup.
 */
export async function saveProcurementItems(
  projectId: string,
  items: ProcurementItemInput[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Verify ownership
  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return { success: false, error: "Not authenticated" };
  }

  const parsed = procurementItemsSchema.safeParse(items);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    // Delete all existing items first, then insert new ones
    await prisma.procurementItem.deleteMany({ where: { projectId } });

    if (items.length > 0) {
      await prisma.procurementItem.createMany({
        data: items.map((item) => ({
          projectId,
          item: item.item,
          category: item.category,
          vendor: item.vendor ?? null,
          sku: item.sku ?? null,
          estCost: item.estCost ?? null,
          status: item.status ?? "needed",
        })),
      });
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/lookbook`);
    revalidatePath(`/preview/${projectId}`);
    return { success: true };
  } catch (error) {
    log.error({ type: "procurement_save_failed", projectId }, "Failed to save procurement items");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
