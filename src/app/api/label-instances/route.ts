import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { visionLabelRequestSchema } from "@/lib/ai-route-schemas";
import { checkLabelQuota, validateLabelRoom, generateVisionLabels } from "@/lib/label-instances-service";
import { API_ERROR_UNAUTHORIZED, API_ERROR_INVALID_REQUEST } from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be signed in to label instances.",
      status: 401,
    });
  }

  await checkLabelQuota(user.id);

  const parsed = visionLabelRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "Some required information is missing or invalid.",
      status: 400,
      details: parsed.error.issues,
    });
  }

  const { roomId, concept, crops, imageUrl } = parsed.data;

  await validateLabelRoom(roomId, user.id);

  const { labels } = await generateVisionLabels({
    imageUrl,
    concept,
    crops,
    userId: user.id,
    roomId,
  });

  return NextResponse.json({ success: true, labels }, { status: 200 });
});
