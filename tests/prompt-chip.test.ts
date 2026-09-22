import { describe, expect, it } from "vitest";
import type { PromptChipProps, PromptChipVariant } from "@/components/ui/prompt-chip";

describe("PromptChip types", () => {
  it("exports PromptChipVariant as a union type with 4 variants", () => {
    const variants: PromptChipVariant[] = ["suggestion", "directive", "injection", "filter"];
    expect(variants).toHaveLength(4);
  });

  it("exports PromptChipProps interface with required label", () => {
    const props: PromptChipProps = { label: "test" };
    expect(props.label).toBe("test");
  });

  it("PromptChipProps accepts all optional fields", () => {
    const props: PromptChipProps = {
      label: "test",
      variant: "suggestion",
      icon: "auto_awesome",
      onClick: () => {},
      onDismiss: () => {},
      active: true,
      className: "custom-class",
    };
    expect(props.variant).toBe("suggestion");
    expect(props.icon).toBe("auto_awesome");
    expect(props.active).toBe(true);
    expect(props.className).toBe("custom-class");
  });

  it("PromptChipProps has correct default values in type sense", () => {
    const props: PromptChipProps = { label: "test" };
    expect(props.label).toBe("test");
    expect(props.variant).toBeUndefined();
    expect(props.icon).toBeUndefined();
    expect(props.onClick).toBeUndefined();
    expect(props.onDismiss).toBeUndefined();
    expect(props.active).toBeUndefined();
  });
});
