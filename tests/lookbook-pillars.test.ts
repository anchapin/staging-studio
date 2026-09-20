import { describe, expect, it } from "vitest";

import { extractPillars } from "@/lib/lookbook-pillars";

const FALLBACK_PILLARS = [
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

function makeRoom(
  overrides: Partial<Parameters<typeof extractPillars>[0]> = {}
): Parameters<typeof extractPillars>[0] {
  return {
    observedChallenge: null,
    recommendation: null,
    buyerPsychology: null,
    rawDirectives: null,
    ...overrides,
  };
}

describe("extractPillars", () => {
  it("derives pillars from real content for a full-copy room", () => {
    const pillars = extractPillars(
      makeRoom({
        observedChallenge: "The living room feels disjointed and cramped.",
        recommendation: "Rearrange seating to open sightlines to the windows.",
        buyerPsychology: "Buyers crave bright, social gathering spaces.",
        rawDirectives: "Keep the existing hardwood floors visible.",
      })
    );

    expect(pillars).toEqual([
      {
        title: "Observed Challenge",
        description: "The living room feels disjointed and cramped.",
      },
      {
        title: "Our Approach",
        description: "Rearrange seating to open sightlines to the windows.",
      },
      {
        title: "Buyer Psychology",
        description: "Buyers crave bright, social gathering spaces.",
      },
    ]);
  });

  it("returns exactly the documented fallback set for a null-copy room", () => {
    expect(extractPillars(makeRoom())).toEqual(FALLBACK_PILLARS);
  });

  it("returns exactly the documented fallback set when fields are undefined", () => {
    expect(extractPillars({})).toEqual(FALLBACK_PILLARS);
  });

  it("treats empty-string copy as missing and falls back entirely", () => {
    expect(
      extractPillars(
        makeRoom({ observedChallenge: "", recommendation: "" })
      )
    ).toEqual(FALLBACK_PILLARS);
  });

  it("tops up a two-field room with one Design Priority filler", () => {
    const pillars = extractPillars(
      makeRoom({
        observedChallenge: "The entry lacks a focal point.",
        recommendation: "Add a console and mirror to anchor the space.",
      })
    );

    expect(pillars).toEqual([
      {
        title: "Observed Challenge",
        description: "The entry lacks a focal point.",
      },
      {
        title: "Our Approach",
        description: "Add a console and mirror to anchor the space.",
      },
      {
        title: "Design Priority",
        description:
          "Attention to detail ensures lasting impressions that resonate with discerning buyers.",
      },
    ]);
  });

  it("mixes one real pillar with a Design Priority filler (padded once)", () => {
    const pillars = extractPillars(
      makeRoom({ recommendation: "Swap the dated light fixture." })
    );

    expect(pillars).toEqual([
      { title: "Our Approach", description: "Swap the dated light fixture." },
      {
        title: "Design Priority",
        description:
          "Attention to detail ensures lasting impressions that resonate with discerning buyers.",
      },
    ]);
  });

  it("keeps source-field order when deriving pillars", () => {
    const pillars = extractPillars(
      makeRoom({
        rawDirectives: "Stage with warm neutrals.",
        buyerPsychology: "Empty rooms read as smaller than they are.",
      })
    );

    expect(pillars.map((p) => p.title)).toEqual([
      "Buyer Psychology",
      "Key Directives",
      "Design Priority",
    ]);
  });

  it("caps output at three pillars, dropping Key Directives first", () => {
    const pillars = extractPillars(
      makeRoom({
        observedChallenge: "challenge",
        recommendation: "recommendation",
        buyerPsychology: "psychology",
        rawDirectives: "directives",
      })
    );

    expect(pillars).toHaveLength(3);
    expect(pillars.map((p) => p.title)).toEqual([
      "Observed Challenge",
      "Our Approach",
      "Buyer Psychology",
    ]);
  });
});
