"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnership } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const materialSwatchSchema = z.object({
  name: z.string().min(1).max(100),
  hexCode: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color (e.g. #C8A882)"),
  materialType: z.string().min(1).max(50),
  useCase: z.string().min(1).max(50),
  vendor: z.string().max(100).optional(),
  sku: z.string().max(100).optional(),
  sortOrder: z.number().int().optional(),
});

type MaterialSwatchInput = z.infer<typeof materialSwatchSchema>;

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

/**
 * Server action: upserts (create or update) a material swatch for a project.
 *
 * Contract: requires an authenticated session; the upsert's `where` filter
 * (`projectId` + ownership check) enforces that only the owning user can mutate
 * their project's swatches. Failures are caught and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session cookie;
 * performs a Prisma `upsert`; logs failures to `console.error`. Revalidates
 * the project lookbook path on success.
 */
export async function saveMaterialSwatch(
  projectId: string,
  swatch: MaterialSwatchInput & { id?: string }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  try {
    await requireProjectOwnership(projectId, user.id);
  } catch {
    return failure("Project not found");
  }

  const parsed = materialSwatchSchema.safeParse(swatch);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Invalid swatch payload"
    );
  }

  const data = parsed.data;

  try {
    if (swatch.id) {
      const result = await prisma.materialSwatch.update({
        where: { id: swatch.id, projectId },
        data: {
          name: data.name,
          hexCode: data.hexCode,
          materialType: data.materialType,
          useCase: data.useCase,
          vendor: data.vendor ?? null,
          sku: data.sku ?? null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
      revalidatePath(`/projects/${projectId}`);
      return { success: true, id: result.id };
    } else {
      const result = await prisma.materialSwatch.create({
        data: {
          projectId,
          name: data.name,
          hexCode: data.hexCode,
          materialType: data.materialType,
          useCase: data.useCase,
          vendor: data.vendor ?? null,
          sku: data.sku ?? null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
      revalidatePath(`/projects/${projectId}`);
      return { success: true, id: result.id };
    }
  } catch (error) {
    console.error(
      JSON.stringify({ event: "save_material_swatch_failed", projectId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Server action: deletes a material swatch.
 *
 * Contract: requires an authenticated session; the delete's `where` filter
 * enforces ownership. Failures are caught and reported, never thrown.
 *
 * Side effects: performs a Prisma `delete`; logs failures;
 * revalidates the project lookbook path on success.
 */
export async function deleteMaterialSwatch(
  projectId: string,
  swatchId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  try {
    await requireProjectOwnership(projectId, user.id);
  } catch {
    return failure("Project not found");
  }

  try {
    await prisma.materialSwatch.delete({
      where: { id: swatchId, projectId },
    });
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "delete_material_swatch_failed", swatchId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Server action: replaces all material swatches for a project.
 *
 * Contract: requires an authenticated session; replaces all swatches for the
 * project under the user's ownership. Failures are caught and reported.
 *
 * Side effects: performs Prisma deletes + creates in a transaction;
 * revalidates the project lookbook path on success.
 */
export async function replaceMaterialSwatches(
  projectId: string,
  swatches: MaterialSwatchInput[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  try {
    await requireProjectOwnership(projectId, user.id);
  } catch {
    return failure("Project not found");
  }

  const parsed = z.array(materialSwatchSchema).safeParse(swatches);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Invalid swatches payload"
    );
  }

  try {
    await prisma.$transaction([
      prisma.materialSwatch.deleteMany({ where: { projectId } }),
      ...parsed.data.map((s, index) =>
        prisma.materialSwatch.create({
          data: {
            projectId,
            name: s.name,
            hexCode: s.hexCode,
            materialType: s.materialType,
            useCase: s.useCase,
            vendor: s.vendor ?? null,
            sku: s.sku ?? null,
            sortOrder: s.sortOrder ?? index,
          },
        })
      ),
    ]);
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "replace_material_swatches_failed", projectId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
