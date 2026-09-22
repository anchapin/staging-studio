import type { ChecklistItem } from "@/lib/checklist-schema";

export type { ChecklistItem };

export interface RoomData {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  /** Variant B slot (issue #253): the spread renders the selected variant's pair. */
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
  /** Prisma `Int?` — null means no explicit selection. */
  selectedVariantIndex?: number | null;
  rawDirectives?: string | null;
  observedChallenge?: string | null;
  recommendation?: string | null;
  buyerPsychology?: string | null;
  checklistItems?: ChecklistItem[] | null;
}

export interface UserData {
  firmName: string;
  ownerName: string;
  logoUrl?: string | null;
  email?: string | null;
  psychologyPageContent?: string | null;
  signoffContent?: string | null;
}

export interface ProjectData {
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
}

export interface LookbookRoomData extends RoomData {
  project: ProjectData;
  user: UserData;
}

/** ROI Metric card data (issue #552) */
export interface ROIMetric {
  /** Display value shown in large text, e.g. "+8–12%" */
  value: string;
  /** Short label below the value, e.g. "Estimated Sales Price Premium" */
  title: string;
  /** Contextual paragraph beneath the title */
  description: string;
  /** Lucide icon name */
  icon: "trending_up" | "clock" | "dollar";
}
