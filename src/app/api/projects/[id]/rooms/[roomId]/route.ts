import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { roomPatchSchema } from "@/lib/room-patch-schema";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  try {
    const { id: projectId, roomId } = await params;

    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update a room.", code: API_ERROR_UNAUTHORIZED },
        { status: 401 }
      );
    }

    const parsed = roomPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", message: "The request body is invalid.", issues: parsed.error.issues, code: API_ERROR_INVALID_REQUEST },
        { status: 400 }
      );
    }

    // The schema is partial (all fields optional), so `{}` parses — but
    // Prisma's `updateMany` throws on empty `data`, and a no-op patch is
    // a client bug worth surfacing.
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: "Invalid request body", message: "At least one field is required.", issues: [{ message: "At least one field is required" }], code: API_ERROR_INVALID_REQUEST },
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
      return NextResponse.json(
        { error: "Room not found", message: "The requested room could not be found.", code: API_ERROR_ROOM_NOT_FOUND },
        { status: 404 }
      );
    }

    const room = await prisma.room.findFirst({ where: ownershipWhere });
    if (!room) {
      return NextResponse.json(
        { error: "Room not found", message: "The requested room could not be found.", code: API_ERROR_ROOM_NOT_FOUND },
        { status: 404 }
      );
    }

    return NextResponse.json(room);
  } catch (error) {
    console.error("Error updating room:", error);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to update room.", code: API_ERROR_INTERNAL_SERVER },
      { status: 500 }
    );
  }
}
