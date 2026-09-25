import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
<<<<<<< HEAD
import { listProjects, createProject } from "@/lib/projects-service";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { API_ERROR_UNAUTHORIZED } from "@/lib/api-errors";
=======
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_USER_NOT_FOUND,
} from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
>>>>>>> origin/develop

// GET: List the authed user's projects (scoped to caller)
export const GET = withErrorHandler(async () => {
  const userRow = await getAuthedPrismaUser();
  if (!userRow) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be logged in to access this resource.",
      status: 401,
    });
  }
<<<<<<< HEAD
  const projects = await listProjects(userRow.id);
=======

  const projects = await prisma.project.findMany({
    where: { userId: userRow.id },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      stagingAesthetic: true,
      createdAt: true,
      rooms: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
>>>>>>> origin/develop
  return NextResponse.json(projects);
});

// POST: Create a new project (auth-protected)
<<<<<<< HEAD
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const {
    propertyAddress,
    clientName,
    targetBuyer,
    stagingAesthetic,
    buyerDemographics,
    stagingPackage,
    rooms,
  } = body;

  const project = await createProject({
    propertyAddress,
    clientName,
    targetBuyer,
    stagingAesthetic,
    buyerDemographics,
    stagingPackage: stagingPackage ?? null,
    rooms: rooms ?? [],
  });

  return NextResponse.json(project, { status: 201 });
=======
export const POST = withErrorHandler(async (request: Request) => {
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

  const body = await request.json();
  const {
    propertyAddress,
    clientName,
    targetBuyer,
    stagingAesthetic,
    buyerDemographics,
    stagingPackage,
    rooms,
  } = body;

  if (!propertyAddress || !clientName || !targetBuyer || !stagingAesthetic) {
    throw new ApiError({
      code: API_ERROR_MISSING_REQUIRED_FIELDS,
      message: "propertyAddress, clientName, targetBuyer, and stagingAesthetic are required.",
      status: 400,
    });
  }

  const userRow = await prisma.user.findUnique({
    where: { email: user.email },
  });

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
      propertyAddress,
      clientName,
      targetBuyer,
      stagingAesthetic,
      stagingPackage: stagingPackage ?? null,
      buyerDemographics: buyerDemographics ?? undefined,
      rooms: {
        create: rooms.map((name: string) => ({ name })),
      },
    },
    include: { rooms: true },
  });

  return NextResponse.json(project);
>>>>>>> origin/develop
});
