import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { ApiError } from "@/lib/api-error-handler";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_USER_NOT_FOUND,
} from "@/lib/api-errors";

// ─── List Projects ─────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string | null;
  createdAt: Date;
  rooms: Array<{ id: string; name: string }>;
}

/**
 * Lists all projects belonging to a user, ordered by creation date descending.
 */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  return prisma.project.findMany({
    where: { userId },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      stagingAesthetic: true,
      createdAt: true,
      rooms: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Create Project ────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  stagingPackage?: string | null;
  buyerDemographics?: Record<string, unknown>;
  rooms: string[];
}

export interface CreateProjectResult {
  id: string;
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  stagingPackage: string | null;
  buyerDemographics: Record<string, unknown> | undefined;
  rooms: Array<{ id: string; name: string }>;
  createdAt: Date;
}

/**
 * Creates a new project with the given data and initial rooms.
 * Validates that the user exists in the database before creating the project.
 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const supabase = await createSupabaseRequestClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be logged in to create a project.",
      status: 401,
    });
  }

  if (!input.propertyAddress || !input.clientName || !input.targetBuyer || !input.stagingAesthetic) {
    throw new ApiError({
      code: API_ERROR_MISSING_REQUIRED_FIELDS,
      message: "propertyAddress, clientName, targetBuyer, and stagingAesthetic are required.",
      status: 400,
    });
  }

  const userRow = await prisma.user.findUnique({ where: { email: user.email } });

  if (!userRow) {
    throw new ApiError({
      code: API_ERROR_USER_NOT_FOUND,
      message: "User not found in database.",
      status: 404,
    });
  }

  const project = await prisma.project.create({
    data: {
      userId: userRow.id,
      propertyAddress: input.propertyAddress,
      clientName: input.clientName,
      targetBuyer: input.targetBuyer,
      stagingAesthetic: input.stagingAesthetic,
      stagingPackage: input.stagingPackage ?? null,
      buyerDemographics: (input.buyerDemographics ?? undefined) as object ?? undefined,
      rooms: { create: input.rooms.map((name: string) => ({ name })) },
    },
    include: { rooms: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = project as any;

  return {
    id: project.id,
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
    stagingPackage: project.stagingPackage,
    buyerDemographics: (project.buyerDemographics ?? undefined) as Record<string, unknown> | undefined,
    rooms: p.rooms.map((room: { id: string; name: string }) => ({ id: room.id, name: room.name })),
    createdAt: project.createdAt,
  };
}
