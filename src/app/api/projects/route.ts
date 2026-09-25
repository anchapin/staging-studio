import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { listProjects, createProject } from "@/lib/projects-service";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { API_ERROR_UNAUTHORIZED } from "@/lib/api-errors";

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
  const projects = await listProjects(userRow.id);
  return NextResponse.json(projects);
});

// POST: Create a new project (auth-protected)
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
});
