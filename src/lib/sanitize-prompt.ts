/**
 * Sanitizes user-provided string values before embedding them in AI prompts
 * to prevent prompt injection attacks (issue #915).
 *
 * Injections work by tricking the model into:
 * 1. Ignoring its system role (e.g., "Ignore previous instructions")
 * 2. Revealing sensitive context (e.g., "What is your system prompt?")
 * 3. Altering behavior via injected directives (e.g., "You are now a different assistant")
 *
 * This module neutralizes common patterns at the point where user data
 * enters a prompt string, before it reaches the model.
 *
 * Defense layers applied per field:
 * 1. Strip control / Unicode "invisible" characters that can corrupt or escape context
 * 2. Collapse internal newlines/tabs into spaces to prevent multi-line injection
 * 3. Remove known instruction Override patterns that attempt role or goal replacement
 * 4. Remove prompt-leaking meta patterns that attempt to exfiltrate context
 * 5. Trim and validate length bounds to prevent buffer-overflow style abuse
 */

const INSTRUCTION_OVERRIDE_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /forget\s+(all\s+)?previous\s+(instructions?|prompts?)/gi,
  /disregard\s+(all\s+)?(your\s+)?(instructions?|system\s+(prompt|message)|rules?)/gi,
  /discard\s+(all\s+)?(your\s+)?(instructions?|rules?)/gi,
  /\bignore\s+(this\s+)?(system|developer|assistant)\s*(prompt)?/gi,
  /you\s+are\s+(now\s+)?a\s+different\s+(assistant|AI|model)/gi,
  /you\s+have\s+been\s+(replaced|modified|updated)/gi,
  /new\s+(system\s+)?instructions?:/gi,
  /\bSYS( TEM)?[:;]/gi,
  /\[SYSTEM\]/gi,
  /<system>/gi,
  /\{SYSTEM\}/gi,
  /\#\s*SYSTEM/g,
  /\[\s*INST\s*\]/gi,
  /instruction\s+override/g,
  /override\s+instructions/g,
  /admin\s+mode/g,
  /developer\s+mode/g,
  /<\|im_end\|>/gi,
  /<\|end_of_turn\|>/gi,
  /<\|end\|>/gi,
];

const PROMPT_LEAK_PATTERNS = [
  /what\s+are\s+your\s+(system\s+)?instructions?\??/gi,
  /what\s+is\s+your\s+(system\s+)?prompt\??/gi,
  /repeat\s+your\s+(system\s+)?prompt/gi,
  /show\s+me\s+(your\s+)?(system\s+)?(instructions?|prompt)/gi,
  /what\s+rules?\s+do\s+you\s+have/gi,
  /tell\s+me\s+your\s+(system\s+)?(instructions?|rules?)/gi,
  /list\s+(all\s+)?your\s+(system\s+)?instructions/gi,
  /output\s+your\s+training\s+data/gi,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?)/gi,
  /print\s+(out\s+)?(your\s+)?(system\s+)?prompt/gi,
  /ignore\s+all\s+previous.*context/gi,
  /clear\s+(your\s+)?(context|history|memory)/gi,
];

function removePatterns(value: string, patterns: RegExp[]): string {
  let result = value;
  for (const pattern of patterns) {
    result = result.replace(pattern, " ");
  }
  return result;
}

function removeInvisibleCharacters(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .replace(/[\u2060\u2061-\u2064]/g, "");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function applySanitization(input: string): string {
  if (!input) return input;
  const step1 = removeInvisibleCharacters(input);
  const step2 = removePatterns(step1, INSTRUCTION_OVERRIDE_PATTERNS);
  const step3 = removePatterns(step2, PROMPT_LEAK_PATTERNS);
  return collapseWhitespace(step3);
}

export interface SanitizePromptOptions {
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 2000;

export function sanitizePromptValue(
  value: string | null | undefined,
  options: SanitizePromptOptions = {}
): string {
  if (value == null) return "";
  const { maxLength = DEFAULT_MAX_LENGTH } = options;
  const sanitized = applySanitization(String(value));
  return sanitized.slice(0, maxLength);
}

export function sanitizePromptArray(
  values: readonly string[] | null | undefined,
  options: SanitizePromptOptions = {}
): string[] {
  if (!values) return [];
  return values.map((v) => sanitizePromptValue(v, options));
}

export function sanitizePromptRecord(
  record: Record<string, string | null | undefined> | null | undefined,
  options: SanitizePromptOptions = {}
): Record<string, string> {
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = sanitizePromptValue(value, options);
  }
  return result;
}
