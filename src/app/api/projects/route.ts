import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_USER_NOT_FOUND,
} from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { projectCreateRequestSchema } from "@/lib/project-create-schema";

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
  return NextResponse.json(projects);
});

// POST: Create a new project (auth-protected)
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

  // Issue #1134: the body is validated BEFORE it reaches Prisma. The
  // room list is capped, and `buyerDemographics` must match the shape
  // the lookbook's buyer-persona page destructures — an unvalidated
  // value here fails the PDF export for the whole lookbook, because
  // that page renders inside the cookie-less print route Browserless
  // fetches.
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = projectCreateRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    // A missing/empty required field keeps the original copy the client
    // renders; everything else (room cap, bad demographics shape,
    // unknown key) reports the specific issue.
    const REQUIRED_FIELDS = new Set([
      "propertyAddress",
      "clientName",
      "targetBuyer",
      "stagingAesthetic",
    ]);
    const requiredFieldIssue = parsed.error.issues.some((issue) =>
      REQUIRED_FIELDS.has(String(issue.path[0]))
    );

    throw new ApiError({
      code: API_ERROR_MISSING_REQUIRED_FIELDS,
      message: requiredFieldIssue
        ? "propertyAddress, clientName, targetBuyer, and stagingAesthetic are required."
        : (parsed.error.issues[0]?.message ?? "The project details could not be read."),
      status: 400,
    });
  }

  const {
    propertyAddress,
    clientName,
    targetBuyer,
    stagingAesthetic,
    buyerDemographics,
    stagingPackage,
    rooms,
  } = parsed.data;

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
        create: rooms.map((name) => ({ name })),
      },
    },
    include: { rooms: true },
  });

  return NextResponse.json(project);
});
