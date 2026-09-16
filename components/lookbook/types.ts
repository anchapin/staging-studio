export interface ChecklistItem {
  item: string;
  category: string;
  priority: "high" | "medium" | "low";
}

export interface RoomData {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  selectedVariantIndex?: number;
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
