import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_INTERNAL_SERVER,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_USER_NOT_FOUND,
} from "@/lib/api-errors";

// GET: List the authed user's projects (scoped to caller)
export async function GET() {
  try {
    const userRow = await getAuthedPrismaUser();

    if (!userRow) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to access this resource.", code: API_ERROR_UNAUTHORIZED },
        { status: 401 }
      );
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
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to fetch projects.", code: API_ERROR_INTERNAL_SERVER },
      { status: 500 }
    );
  }
}

// POST: Create a new project (auth-protected)
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseRequestClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to create a project.", code: API_ERROR_UNAUTHORIZED },
        { status: 401 }
      );
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
      return NextResponse.json(
        { error: "Missing required fields", message: "propertyAddress, clientName, targetBuyer, and stagingAesthetic are required.", code: API_ERROR_MISSING_REQUIRED_FIELDS },
        { status: 400 }
      );
    }

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
    });

    if (!userRow) {
      return NextResponse.json(
        { error: "User not found", message: "User not found in database.", code: API_ERROR_USER_NOT_FOUND },
        { status: 404 }
      );
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
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to create project.", code: API_ERROR_INTERNAL_SERVER },
      { status: 500 }
    );
  }
}
