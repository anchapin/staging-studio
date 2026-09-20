export interface DesignPillar {
  title: string;
  description: string;
}

export interface LookbookPillarSource {
  observedChallenge?: string | null;
  recommendation?: string | null;
  buyerPsychology?: string | null;
  rawDirectives?: string | null;
}

const GENERIC_FILLER: DesignPillar = {
  title: "Design Priority",
  description:
    "Attention to detail ensures lasting impressions that resonate with discerning buyers.",
};

const GENERIC_FALLBACK_PILLARS: DesignPillar[] = [
  {
    title: "First Impression",
    description:
      "Creating an inviting atmosphere that welcomes potential buyers from the moment they enter.",
  },
  {
    title: "Lifestyle Appeal",
    description:
      "Highlighting the unique character of the space while allowing buyers to envision their own story.",
  },
  {
    title: "Quality Craftsmanship",
    description:
      "Every detail reflects the quality they can expect from the entire home.",
  },
];

/**
 * Derives the three design pillars shown on a room spread, from the room's
 * LLM-generated copy. Pillars are built in field order (observed challenge,
 * recommendation, buyer psychology, raw directives) and capped at three; when
 * fewer than three pillars can be derived, a single generic "Design Priority"
 * filler is appended, and when no copy exists at all, a fully generic
 * fallback set is returned.
 */
export function extractPillars(
  room: LookbookPillarSource
): Array<DesignPillar> {
  const pillars: Array<DesignPillar> = [];

  if (room.observedChallenge) {
    pillars.push({
      title: "Observed Challenge",
      description: room.observedChallenge,
    });
  }

  if (room.recommendation) {
    pillars.push({
      title: "Our Approach",
      description: room.recommendation,
    });
  }

  if (room.buyerPsychology) {
    pillars.push({
      title: "Buyer Psychology",
      description: room.buyerPsychology,
    });
  }

  if (room.rawDirectives) {
    pillars.push({
      title: "Key Directives",
      description: room.rawDirectives,
    });
  }

  while (pillars.length < 3 && pillars.length > 0) {
    if (!pillars.find((p) => p.title === GENERIC_FILLER.title)) {
      pillars.push(GENERIC_FILLER);
    } else {
      break;
    }
  }

  if (pillars.length === 0) {
    return GENERIC_FALLBACK_PILLARS;
  }

  return pillars.slice(0, 3);
}
