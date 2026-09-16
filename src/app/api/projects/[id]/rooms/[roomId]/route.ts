import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const body = await request.json();

    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        selectedVariantIndex: body.selectedVariantIndex,
        beforeImageUrl: body.beforeImageUrl,
        afterImageUrl: body.afterImageUrl,
        beforeImageUrl2: body.beforeImageUrl2,
        afterImageUrl2: body.afterImageUrl2,
      },
    });

    return NextResponse.json(room);
  } catch (error) {
    console.error("Error updating room:", error);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
