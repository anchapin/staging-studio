import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { roomPatchSchema } from "@/lib/room-patch-schema";
import {
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) => {
  const { id: projectId, roomId } = await params;

  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be logged in to update a room.",
      status: 401,
    });
  }

  const parsed = roomPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "The request body is invalid.",
      status: 400,
      details: parsed.error.issues,
    });
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "At least one field is required.",
      status: 400,
    });
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
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }

  const room = await prisma.room.findFirst({ where: ownershipWhere });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }

  return NextResponse.json(room);
});
