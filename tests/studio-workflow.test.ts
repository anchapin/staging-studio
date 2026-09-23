import { describe, expect, it } from "vitest";

import {
  STUDIO_GOAL_OPTIONS,
  STUDIO_SCOPE_OPTIONS,
  STUDIO_STEPS,
  buildStudioDirectivesSummary,
  nextStudioStep,
  previousStudioStep,
  resolveStudioStepFromPath,
  studioStepHref,
} from "@/lib/studio-workflow";

describe("STUDIO_STEPS", () => {
  it("defines the four pipeline steps in order", () => {
    expect(STUDIO_STEPS.map((step) => step.id)).toEqual([
      "setup",
      "rooms",
      "refine",
      "report",
    ]);
  });

  it("numbers steps 1 through 4", () => {
    STUDIO_STEPS.forEach((step, i) => {
      expect(step.index).toBe(i + 1);
    });
  });

  it("gives every step a short label and a title", () => {
    for (const step of STUDIO_STEPS) {
      expect(step.shortLabel.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
    }
  });
});

describe("studioStepHref", () => {
  it("builds the nested project route for each step", () => {
    expect(studioStepHref("abc", "setup")).toBe("/projects/abc/setup");
    expect(studioStepHref("abc", "rooms")).toBe("/projects/abc/rooms");
    expect(studioStepHref("abc", "refine")).toBe("/projects/abc/refine");
    expect(studioStepHref("abc", "report")).toBe("/projects/abc/report");
  });
});

describe("resolveStudioStepFromPath", () => {
  it.each([
    ["/projects/abc/setup", "setup"],
    ["/projects/abc/rooms", "rooms"],
    ["/projects/abc/refine", "refine"],
    ["/projects/abc/report", "report"],
  ] as const)("matches %s", (pathname, expected) => {
    expect(resolveStudioStepFromPath(pathname)).toBe(expected);
  });

  it("tolerates a trailing slash", () => {
    expect(resolveStudioStepFromPath("/projects/abc/refine/")).toBe("refine");
  });

  it("returns null outside the workflow", () => {
    expect(resolveStudioStepFromPath("/projects/abc")).toBeNull();
    expect(resolveStudioStepFromPath("/projects/abc/lookbook")).toBeNull();
    expect(resolveStudioStepFromPath("/projects/new")).toBeNull();
    expect(resolveStudioStepFromPath("/dashboard")).toBeNull();
    expect(resolveStudioStepFromPath("/projects/abc/refine/extra")).toBeNull();
  });
});

describe("nextStudioStep / previousStudioStep", () => {
  it("walks the pipeline forward", () => {
    expect(nextStudioStep("setup")).toBe("rooms");
    expect(nextStudioStep("rooms")).toBe("refine");
    expect(nextStudioStep("refine")).toBe("report");
  });

  it("has no step after the report", () => {
    expect(nextStudioStep("report")).toBeNull();
  });

  it("walks the pipeline backward", () => {
    expect(previousStudioStep("rooms")).toBe("setup");
    expect(previousStudioStep("refine")).toBe("rooms");
    expect(previousStudioStep("report")).toBe("refine");
  });

  it("has no step before setup", () => {
    expect(previousStudioStep("setup")).toBeNull();
  });
});

describe("STUDIO_SCOPE_OPTIONS", () => {
  it("lists the three spec scopes", () => {
    expect(STUDIO_SCOPE_OPTIONS.map((option) => option.id)).toEqual([
      "full-5-room",
      "light-refresh",
      "virtual-declutter",
    ]);
  });
});

describe("STUDIO_GOAL_OPTIONS", () => {
  it("lists the three spec goals", () => {
    expect(STUDIO_GOAL_OPTIONS.map((option) => option.id)).toEqual([
      "client-pitch",
      "listing-deck",
      "mls-renders",
    ]);
  });
});

describe("buildStudioDirectivesSummary", () => {
  it("returns an empty string for a fully unconfigured form", () => {
    expect(buildStudioDirectivesSummary({})).toBe("");
  });

  it("includes only the chosen pieces, joined with a middle dot", () => {
    const summary = buildStudioDirectivesSummary({
      themeName: "Warm Organic Modern",
      scope: "full-5-room",
      goal: "listing-deck",
    });
    expect(summary).toBe(
      "Aesthetic: Warm Organic Modern · Scope: Full 5-Room Staging · Goal: Listing Deck"
    );
  });

  it("appends the micro-parameter values when provided", () => {
    const summary = buildStudioDirectivesSummary({
      themeName: "Japandi Minimalist",
      microParameters: { preservationStrictness: 94, foliageFill: 65 },
    });
    expect(summary).toBe(
      "Aesthetic: Japandi Minimalist · Preservation strictness 94, foliage fill 65"
    );
  });

  it("renders the scope label without other selections", () => {
    const summary = buildStudioDirectivesSummary({
      scope: "full-5-room",
      goal: null,
    });
    expect(summary).toBe("Scope: Full 5-Room Staging");
  });
});
