import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userRow = await getAuthedPrismaUser();

    if (!userRow) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
          select: {
            id: true,
            name: true,
            beforeImageUrl: true,
            afterImageUrl: true,
            beforeImageUrl2: true,
            afterImageUrl2: true,
            selectedVariantIndex: true,
            observedChallenge: true,
            recommendation: true,
            buyerPsychology: true,
            checklistItems: true,
            inpaintRequests: {
              where: { status: { in: ["IN_QUEUE", "IN_PROGRESS"] } },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}
