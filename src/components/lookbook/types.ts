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

export type BuyerType =
  | "young_professional"
  | "growing_family"
  | "downsizing_retiree"
  | "investor"
  | "luxury_buyer"
  | "first_time_homebuyer"
  | "serial_renovator";

export type DesignPreference =
  | "contemporary"
  | "traditional"
  | "minimalist"
  | "maximalist"
  | "coastal"
  | "industrial"
  | "midcentury_modern"
  | "scandinavian"
  | "bohemian"
  | "transitional";

export type MustHaveFeature =
  | "home_office"
  | "open_plan"
  | "outdoor_space"
  | "gourmet_kitchen"
  | "master_suite"
  | "smart_home"
  | "energy_efficient"
  | "multigenerational"
  | "home_gym"
  | "pet_friendly";

export type SellTimeline =
  | "under_30_days"
  | "30_60_days"
  | "60_90_days"
  | "over_90_days";

export interface BuyerDemographics {
  buyerType: BuyerType;
  designPreferences: DesignPreference[];
  budgetMin: number;
  budgetMax: number;
  mustHaveFeatures: MustHaveFeature[];
  sellTimeline: SellTimeline;
}

export interface ProjectData {
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  /** Client sign-off (issue #556) */
  clientSignature?: string | null;
  clientSignatureStatus?: string | null;
  clientSignatureTimestamp?: string | null;
  /** Project ID for API calls */
  id?: string;
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
