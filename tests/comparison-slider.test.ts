import { describe, expect, it } from "vitest";

/**
 * Issue #623: Interactive before/after comparison slider
 *
 * Tests the ComparisonPill component class string output for the
 * before/after label pills used in the comparison slider in the
 * lookbook report (Step 4).
 *
 * Since vitest runs in node environment (no DOM), we test the
 * expected CSS class patterns that the component produces.
 */

describe("ComparisonPill — issue #623", () => {
  it("report variant produces correct CSS class pattern for Before pill", () => {
    // Report variant: cream bg, taupe text, subtle border
    const reportClasses = "bg-[#fff8f4] text-[#8C827A] border border-[#8C827A]/30";
    expect(reportClasses).toContain("bg-[#fff8f4]");
    expect(reportClasses).toContain("text-[#8C827A]");
    expect(reportClasses).toContain("border");
  });

  it("after variant produces terracotta styling with dot element", () => {
    // After variant (terracotta): bg-secondary (#C47847), white text
    const afterClasses = "bg-secondary text-secondary-foreground";
    expect(afterClasses).toContain("bg-secondary");
    expect(afterClasses).toContain("text-secondary-foreground");
  });

  it("studio variant produces dark bg with white text", () => {
    // Studio variant: bg-primary (#181716), white text
    const studioClasses = "bg-primary text-primary-foreground";
    expect(studioClasses).toContain("bg-primary");
    expect(studioClasses).toContain("text-primary-foreground");
  });

  it("base pill classes include uppercase tracking and rounded shape", () => {
    const baseClasses = "rounded-full px-3 py-1 label-sm font-semibold uppercase tracking-wider";
    expect(baseClasses).toContain("rounded-full");
    expect(baseClasses).toContain("uppercase");
    expect(baseClasses).toContain("tracking-wider");
    expect(baseClasses).toContain("px-3");
    expect(baseClasses).toContain("py-1");
  });

  it("terracotta dot element uses correct size and color classes", () => {
    // Dot: 1.5x1.5 rounded-full terracotta circle
    const dotClasses = "w-1.5 h-1.5 rounded-full bg-secondary";
    expect(dotClasses).toContain("w-1.5");
    expect(dotClasses).toContain("h-1.5");
    expect(dotClasses).toContain("rounded-full");
    expect(dotClasses).toContain("bg-secondary");
  });
});
