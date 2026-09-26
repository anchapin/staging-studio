import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnershipOrThrow } from "@/lib/api-auth";
import { API_ERROR_PROJECT_NOT_FOUND, API_ERROR_UNAUTHORIZED } from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";

export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const userRow = await getAuthedPrismaUser();
  if (!userRow) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be logged in to access this resource.",
      status: 401,
    });
  }

  const { id } = await params;

  try {
    await requireProjectOwnershipOrThrow(id, userRow);
  } catch (e) {
    if (e instanceof Error && e.name === "ProjectNotFoundError") {
      throw new ApiError({
        code: API_ERROR_PROJECT_NOT_FOUND,
        message: "The requested project could not be found.",
        status: 404,
      });
    }
    if (e instanceof Error && e.name === "ProjectForbiddenError") {
      throw new ApiError({
        code: "forbidden",
        message: "You do not have access to this project.",
        status: 403,
      });
    }
    throw e;
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      targetBuyer: true,
      stagingAesthetic: true,
      createdAt: true,
      user: {
        select: {
          firmName: true,
          ownerName: true,
          psychologyPageContent: true,
          signoffContent: true,
        },
      },
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          beforeImageUrl: true,
          afterImageUrl: true,
          beforeImageUrl2: true,
          afterImageUrl2: true,
          selectedVariantIndex: true,
          rawDirectives: true,
          observedChallenge: true,
          recommendation: true,
          buyerPsychology: true,
          checklistItems: true,
          sortOrder: true,
          inpaintRequests: {
            where: { status: { in: ["IN_QUEUE", "IN_PROGRESS"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, variantSlot: true, sourceSlot: true },
          },
        },
      },
    },
  });

  if (!project) {
    throw new ApiError({
      code: API_ERROR_PROJECT_NOT_FOUND,
      message: "The requested project could not be found.",
      status: 404,
    });
  }

  return NextResponse.json(project);
});
