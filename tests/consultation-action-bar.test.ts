import { describe, expect, it } from "vitest";

import {
  CONSULTATION_BAR_DIVIDER_CLASSES,
  CONSULTATION_BAR_INNER_CLASSES,
  CONSULTATION_BAR_PADDING_CLASSES,
  CONSULTATION_BAR_POSITION_CLASSES,
  CONSULTATION_BAR_SUBTEXT,
  CONSULTATION_BAR_SURFACE_CLASSES,
  CONSULTATION_CONFIG_UNCONFIGURED_LABEL,
  CONSULTATION_CTA_WIDTH_CLASSES,
  CONSULTATION_GHOST_CTA_CLASSES,
  CONSULTATION_PRIMARY_CTA_CLASSES,
  CONSULTATION_PULSE_DOT_CORE_CLASSES,
  CONSULTATION_PULSE_DOT_HALO_CLASSES,
  CONSULTATION_SUBTEXT_CLASSES,
  consultationConfigSummary,
} from "@/lib/consultation-action-bar";

/**
 * Issue #619: Sticky bottom consultation action bar.
 *
 * Pins the pure presentation logic: the fixed bottom positioning, the frosted
 * glassmorphic surface, the 1560px inner constraint, the pulsing terracotta
 * dot, the CTA treatments, and the "Configured: [Name]" summary resolver.
 */

describe("Consultation action bar position & surface — issue #619", () => {
  it("pins the bar to the viewport bottom at z-40", () => {
    expect(CONSULTATION_BAR_POSITION_CLASSES).toBe(
      "fixed bottom-0 left-0 right-0 z-40"
    );
  });

  it("uses frosted glassmorphic styling (blur + low-opacity surface + hairline top border)", () => {
    expect(CONSULTATION_BAR_SURFACE_CLASSES).toContain(
      "bg-surface-container-lowest/90"
    );
    expect(CONSULTATION_BAR_SURFACE_CLASSES).toContain("backdrop-blur-md");
    expect(CONSULTATION_BAR_SURFACE_CLASSES).toContain("border-t");
    expect(CONSULTATION_BAR_SURFACE_CLASSES).toContain(
      "border-outline-variant/30"
    );
    expect(CONSULTATION_BAR_SURFACE_CLASSES).toContain("shadow-lg");
  });

  it("applies the spec padding (px-6 py-3.5)", () => {
    expect(CONSULTATION_BAR_PADDING_CLASSES).toBe("px-6 py-3.5");
  });

  it("constrains inner content to max-w-[1560px], centered, stacking on mobile", () => {
    expect(CONSULTATION_BAR_INNER_CLASSES).toContain("max-w-[1560px]");
    expect(CONSULTATION_BAR_INNER_CLASSES).toContain("mx-auto");
    expect(CONSULTATION_BAR_INNER_CLASSES).toContain("flex-col");
    expect(CONSULTATION_BAR_INNER_CLASSES).toContain("sm:flex-row");
  });

  it("hides the divider and subtext on mobile", () => {
    expect(CONSULTATION_BAR_DIVIDER_CLASSES).toContain("hidden");
    expect(CONSULTATION_BAR_DIVIDER_CLASSES).toContain("sm:block");
    expect(CONSULTATION_SUBTEXT_CLASSES).toContain("hidden");
    expect(CONSULTATION_SUBTEXT_CLASSES).toContain("sm:block");
  });
});

describe("Consultation action bar status dot — issue #619", () => {
  it("core dot is terracotta (bg-secondary) with animate-pulse", () => {
    expect(CONSULTATION_PULSE_DOT_CORE_CLASSES).toContain("bg-secondary");
    expect(CONSULTATION_PULSE_DOT_CORE_CLASSES).toContain("animate-pulse");
    expect(CONSULTATION_PULSE_DOT_CORE_CLASSES).toContain("rounded-full");
  });

  it("halo expands with animate-ping behind the core", () => {
    expect(CONSULTATION_PULSE_DOT_HALO_CLASSES).toContain("animate-ping");
    expect(CONSULTATION_PULSE_DOT_HALO_CLASSES).toContain("bg-secondary");
    expect(CONSULTATION_PULSE_DOT_HALO_CLASSES).toContain("absolute");
  });
});

describe("Consultation action bar CTAs — issue #619", () => {
  it("primary CTA hovers primary → secondary over 150ms with a press scale", () => {
    expect(CONSULTATION_PRIMARY_CTA_CLASSES).toContain("bg-primary");
    expect(CONSULTATION_PRIMARY_CTA_CLASSES).toContain("hover:bg-secondary");
    expect(CONSULTATION_PRIMARY_CTA_CLASSES).toContain("duration-150");
    expect(CONSULTATION_PRIMARY_CTA_CLASSES).toContain("active:scale-[0.98]");
  });

  it("ghost CTA is bordered with a hover background change", () => {
    expect(CONSULTATION_GHOST_CTA_CLASSES).toContain("border");
    expect(CONSULTATION_GHOST_CTA_CLASSES).toContain("hover:bg-");
  });

  it("CTAs are full-width on mobile and auto-width from sm up", () => {
    expect(CONSULTATION_CTA_WIDTH_CLASSES).toBe("w-full sm:w-auto");
  });
});

describe("consultationConfigSummary — issue #619", () => {
  it("matches the Screen 1 example shape: aesthetic (… N-room Staging)", () => {
    expect(
      consultationConfigSummary({
        aesthetic: "Organic Modern Luxury",
        packageName: "Premium",
        roomCount: 5,
      })
    ).toBe("Organic Modern Luxury (Premium 5-room Staging)");
  });

  it("prefixes the descriptor with Full for the turnkey package", () => {
    expect(
      consultationConfigSummary({
        aesthetic: "Warm Transitional",
        packageName: "Turnkey",
        roomCount: 4,
      })
    ).toBe("Warm Transitional (Full Turnkey 4-room Staging)");
  });

  it("aesthetic alone renders without a parenthesized descriptor", () => {
    expect(consultationConfigSummary({ aesthetic: "Coastal Minimal" })).toBe(
      "Coastal Minimal"
    );
  });

  it("falls back to the bare descriptor when only package/rooms are set", () => {
    expect(
      consultationConfigSummary({ packageName: "Essential", roomCount: 2 })
    ).toBe("Essential 2-room Staging");
  });

  it("returns the unconfigured label when nothing is selected", () => {
    expect(consultationConfigSummary({})).toBe(
      CONSULTATION_CONFIG_UNCONFIGURED_LABEL
    );
    expect(
      consultationConfigSummary({ aesthetic: "  ", roomCount: 0 })
    ).toBe(CONSULTATION_CONFIG_UNCONFIGURED_LABEL);
  });
});

describe("Consultation action bar copy — issue #619", () => {
  it("pins the descriptive subtext from the spec", () => {
    expect(CONSULTATION_BAR_SUBTEXT).toBe(
      "Ready to ingest raw floor scan photographs and 360 pano captures."
    );
  });
});
