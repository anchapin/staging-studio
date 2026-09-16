import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET: List all projects (public listing for dashboard)
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        rooms: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

// POST: Create a new project (auth-protected)
export async function POST(request: Request) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { propertyAddress, clientName, targetBuyer, stagingAesthetic, rooms } =
      body;

    if (!propertyAddress || !clientName || !targetBuyer || !stagingAesthetic) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
    });

    if (!userRow) {
      return NextResponse.json(
        { error: "User not found in database" },
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
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
