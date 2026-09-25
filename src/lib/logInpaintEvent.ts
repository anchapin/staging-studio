import { logger } from "@/lib/logger";

export type InpaintEventStatus = "submitted" | "completed" | "failed";

export interface InpaintEventInput {
  userId: string;
  requestId: string;
  roomId: string;
  variantSlot: number;
  status: InpaintEventStatus;
}

export function logInpaintEvent(input: InpaintEventInput): void {
  logger.info({
    event: "inpaint",
    userId: input.userId,
    requestId: input.requestId,
    roomId: input.roomId,
    variantSlot: input.variantSlot,
    status: input.status,
  });
}
