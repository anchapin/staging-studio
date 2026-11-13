import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AutoTextarea,
  applyAutoGrow,
} from "@/app/(dashboard)/projects/[id]/lookbook/auto-textarea";

/**
 * Issue #1543 (Modern Web Guidance — field sizing): the lookbook textarea
 * grows with its content. The native `field-sizing: content` declaration is
 * the progressive enhancement; the JavaScript scrollHeight resize stays as
 * the fallback for browsers that do not support the property.
 */

const originalCSS = (globalThis as { CSS?: unknown }).CSS;

afterEach(() => {
  if (originalCSS === undefined) {
    delete (globalThis as { CSS?: unknown }).CSS;
  } else {
    (globalThis as { CSS?: unknown }).CSS = originalCSS;
  }
});

function stubCSS(supports: (property: string, value: string) => boolean) {
  (globalThis as { CSS?: unknown }).CSS = { supports };
}

describe("AutoTextarea field sizing (issue #1543)", () => {
  it("applies field-sizing: content with auto height and full width", () => {
    const html = renderToStaticMarkup(createElement(AutoTextarea, { value: "hello" }));
    expect(html).toContain("field-sizing:content");
    expect(html).toContain("height:auto");
    expect(html).toContain("width:100%");
  });

  it("keeps the one-row minimum", () => {
    const html = renderToStaticMarkup(createElement(AutoTextarea, { value: "hello" }));
    expect(html).toContain('rows="1"');
  });

  it("skips the JavaScript scrollHeight resize where field sizing is supported", () => {
    stubCSS(() => true);
    const setProperty = vi.fn();
    const el = { style: { setProperty, height: "" }, scrollHeight: 120 } as unknown as HTMLTextAreaElement;

    applyAutoGrow(el);

    expect(setProperty).toHaveBeenCalledWith("field-sizing", "content");
    expect(el.style.height).toBe("");
  });

  it("keeps the JavaScript scrollHeight resize where field sizing is unsupported", () => {
    stubCSS(() => false);
    const el = { style: { setProperty: vi.fn(), height: "" }, scrollHeight: 120 } as unknown as HTMLTextAreaElement;

    applyAutoGrow(el);

    expect(el.style.height).toBe("120px");
  });
});
