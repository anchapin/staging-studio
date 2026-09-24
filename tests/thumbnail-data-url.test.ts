import { describe, expect, it } from "vitest";

import {
  MAX_THUMBNAIL_DATA_URL_BYTES,
  validateThumbnailDataUrl,
} from "@/lib/thumbnail-data-url";

describe("validateThumbnailDataUrl", () => {
  it("accepts a valid image data URL", () => {
    const value = `data:image/jpeg;base64,${"A".repeat(200)}`;
    expect(validateThumbnailDataUrl(value)).toEqual({ ok: true });
  });

  it("rejects an http(s):// URL (SSRF vector)", () => {
    expect(validateThumbnailDataUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validateThumbnailDataUrl("http://localhost:3000/internal").ok).toBe(false);
  });

  it("rejects a data:text/... URL", () => {
    const value = `data:text/html;base64,${"A".repeat(200)}`;
    expect(validateThumbnailDataUrl(value).ok).toBe(false);
  });

  it("rejects an oversized base64 payload", () => {
    const maxBase64Chars = Math.ceil((MAX_THUMBNAIL_DATA_URL_BYTES * 4) / 3);
    const value = `data:image/jpeg;base64,${"A".repeat(maxBase64Chars + 4)}`;
    expect(validateThumbnailDataUrl(value).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateThumbnailDataUrl("").ok).toBe(false);
  });
});
