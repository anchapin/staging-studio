import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_PROJECT_NOT_FOUND,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userRow = await getAuthedPrismaUser();

    if (!userRow) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to access this resource.", code: API_ERROR_UNAUTHORIZED },
        { status: 401 }
      );
    }

    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id, userId: userRow.id },
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
            // Issue #169: the focused editor's directives textarea
            // initializes from the room's saved directives when nothing
            // was typed in-session.
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
              // sourceSlot (issue #170) lets a pendingRequestId resume persist
              // the result with the same source semantics the run started with.
              select: { id: true, variantSlot: true, sourceSlot: true },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found", message: "The requested project could not be found.", code: API_ERROR_PROJECT_NOT_FOUND },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to fetch project.", code: API_ERROR_INTERNAL_SERVER },
      { status: 500 }
    );
  }
}
