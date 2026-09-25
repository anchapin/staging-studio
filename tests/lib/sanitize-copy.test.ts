import { describe, it, expect } from "vitest";
import { sanitizeCopy } from "@/lib/sanitize-copy";

describe("sanitizeCopy", () => {
  it("escapes HTML script tags so they render as literal text", () => {
    const input = `<script>alert('xss')</script>Hello`;
    const result = sanitizeCopy(input);
    // Tags are escaped to &lt;script&gt; — safe to render, not executed
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("Hello");
    // The script body is also escaped
    expect(result).toContain("alert");
    expect(result).not.toContain("<script>"); // raw tags gone
  });

  it("escapes img onerror injection as literal text (safe to render)", () => {
    const input = `<img src=x onerror="alert('xss')">Hello`;
    const result = sanitizeCopy(input);
    // The img tag is escaped so onerror can't execute - it renders as literal text
    expect(result).toContain("&lt;img"); // tag escaped to entities
    expect(result).toContain("Hello");
    expect(result).not.toContain("<img"); // raw tags gone
  });

  it("escapes HTML links with javascript: href as literal text", () => {
    const input = `<a href="javascript:alert(1)" onclick="alert(2)">Click</a>`;
    const result = sanitizeCopy(input);
    // All HTML is escaped - href, onclick, javascript all rendered as safe text
    expect(result).not.toContain("<a"); // raw tags gone
    expect(result).toContain("&lt;a"); // escaped
    expect(result).toContain("&gt;"); // closing tag escaped
  });

  it("escapes malformed/unclosed HTML tags", () => {
    const input = `Hello <script>alert(1)< world`;
    const result = sanitizeCopy(input);
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<script>"); // raw tags gone
    expect(result).toContain("&lt;script&gt;"); // escaped, safe
  });

  it("strips HTML comments", () => {
    const input = `Hello<!-- comment -->World`;
    const result = sanitizeCopy(input);
    expect(result).not.toContain("comment");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("removes null bytes and control characters", () => {
    const input = `Hello\x00World\x1FTest`;
    const result = sanitizeCopy(input);
    expect(result).not.toContain("\x00");
    expect(result).not.toContain("\x1f");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).toContain("Test");
  });

  it("preserves newlines", () => {
    const input = `Line one\nLine two\rLine three`;
    const result = sanitizeCopy(input);
    expect(result).toContain("\n");
    expect(result).toContain("Line one");
    expect(result).toContain("Line two");
    expect(result).toContain("Line three");
  });

  it("preserves basic markdown bold", () => {
    const input = `This is **bold** text`;
    const result = sanitizeCopy(input);
    expect(result).toContain("**bold**");
  });

  it("preserves basic markdown italic", () => {
    const input = `This is *italic* text`;
    const result = sanitizeCopy(input);
    expect(result).toContain("*italic*");
  });

  it("handles empty strings", () => {
    expect(sanitizeCopy("")).toBe("");
    expect(sanitizeCopy("   ")).toBe("");
  });

  it("handles null-ish input", () => {
    // @ts-expect-error testing invalid input
    expect(sanitizeCopy(null)).toBe("");
    // @ts-expect-error testing invalid input
    expect(sanitizeCopy(undefined)).toBe("");
  });

  it("limits text length to MAX_COPY_LENGTH", () => {
    const long = "a".repeat(15_000);
    const result = sanitizeCopy(long);
    expect(result.length).toBe(10_000);
  });

  it("does not exceed limit after stripping", () => {
    // String that grows shorter after stripping
    const input = `<script>${"a".repeat(9_990)}</script>`;
    const result = sanitizeCopy(input);
    expect(result.length).toBeLessThanOrEqual(10_000);
  });

  it("trims whitespace at ends", () => {
    const input = `  Hello world  `;
    const result = sanitizeCopy(input);
    expect(result).toBe("Hello world");
  });

  it("preserves line breaks with surrounding content", () => {
    const input = `Start\n\nEnd`;
    const result = sanitizeCopy(input);
    expect(result).toBe("Start\n\nEnd");
  });

  it("escapes HTML in mixed content leaving readable text", () => {
    const input = `Normal text <script>evil</script> more text`;
    const result = sanitizeCopy(input);
    expect(result).toContain("Normal text");
    expect(result).toContain("more text");
    // Script tag is escaped to entities — safe to render
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("evil"); // content between tags preserved
  });
});
