/**
 * Sanitizes AI-generated lookbook copy fields to prevent XSS when rendered
 * in the browser or exported to PDF via Browserless.
 *
 * - Escapes HTML tag delimiters so tags render as literal text
 * - Removes control characters and null bytes
 * - Limits text length to prevent DoS in PDF rendering
 * - Preserves newlines and basic markdown formatting (**bold**, *italic*)
 */

const MAX_COPY_LENGTH = 10_000;

/**
 * Sanitizes a single copy field string.
 *
 * @param text - Raw AI-generated text
 * @returns Sanitized string safe for rendering
 */
export function sanitizeCopy(text: string): string {
  if (!text || typeof text !== "string") return "";

  let sanitized = text;

  // Step 1: Remove null bytes and other control characters (except \n, \r, \t)
  sanitized = sanitized.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  // Step 2: Remove HTML comment markers (potential comment-based filter bypass)
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");

  // Step 3: Escape any < or > to HTML entities.
  // This makes residual HTML/JS tags render as literal text instead of executing.
  // Content between tags is preserved (readable) rather than stripped.
  sanitized = sanitized
    .replace(/&/g, "&amp;") // must be first to avoid double-escaping
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Step 4: Length limit to prevent DoS in PDF rendering
  if (sanitized.length > MAX_COPY_LENGTH) {
    sanitized = sanitized.slice(0, MAX_COPY_LENGTH);
  }

  return sanitized.trim();
}
