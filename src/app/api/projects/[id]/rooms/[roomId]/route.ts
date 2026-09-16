import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { roomPatchSchema } from "@/lib/room-patch-schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  try {
    const { id: projectId, roomId } = await params;

    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = roomPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const ownershipWhere = {
      id: roomId,
      project: { id: projectId, userId: user.id },
    };

    const { count } = await prisma.room.updateMany({
      where: ownershipWhere,
      data: parsed.data,
    });

    if (count === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = await prisma.room.findFirst({ where: ownershipWhere });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json(room);
  } catch (error) {
    console.error("Error updating room:", error);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
