/**
 * Listing URL ingestion — pure logic for issue #1179.
 *
 * Given a pasted listing URL, this module:
 *   1. Validates the host against an allowlist (Zillow in MVP).
 *   2. Extracts the listing's photo URLs and property address from the
 *      fetched HTML.
 *   3. Caps the result at `PROJECT_CREATE_MAX_ROOMS` and reports how
 *      many extras were dropped.
 *
 * The network call lives in the API layer (`src/app/api/listings/ingest`)
 * — these helpers stay pure so they can be pinned by a unit test
 * without spinning up a fetch mock for every case.
 *
 * Side effects: none. The owning store is `PROJECT_CREATE_MAX_ROOMS`.
 */
import { PROJECT_CREATE_MAX_ROOMS } from "@/lib/project-create-schema";

/**
 * Hosts the ingest path supports in MVP. Anything else is rejected
 * with `ListingIngestError` of kind `unsupported-host`.
 *
 * The issue body flags the open question of "which listing sources to
 * support first" — Zillow is the MVP because Lauren gets handed Zillow
 * links for every listing in her area and Zillow renders photos in a
 * stable, scraper-friendly pattern. Other hosts (`realtor.com`,
 * `redfin.com`, MLS feeds) are deliberately not in this list yet: a
 * production scraper needs partner-API access or a ToS review.
 */
export const SUPPORTED_LISTING_HOSTS = ["www.zillow.com", "zillow.com"] as const;

/** A single kind of failure the ingest path can return. */
export type ListingIngestErrorKind =
  | "unsupported-host"
  | "malformed-url"
  | "no-photos"
  | "blocked-by-robots"
  | "external-service-error";

/**
 * Discriminated failure shape. Callers branch on `kind` to render a
 * specific UI message (e.g. "Coming soon: Realtor support" vs. "This
 * listing has no photos we could read").
 */
export interface ListingIngestError {
  kind: ListingIngestErrorKind;
  message: string;
}

export interface ListingIngestPreview {
  /** The host that matched the allowlist, e.g. `"www.zillow.com"`. */
  host: string;
  /** Public image URLs of every listing photo, in source order. */
  photoUrls: string[];
  /** Property address extracted from the listing, or null if absent. */
  propertyAddress: string | null;
  /** Photos dropped because the result exceeded the per-project cap. */
  truncatedCount: number;
}

export type ListingIngestResult =
  | { ok: true; preview: ListingIngestPreview }
  | { ok: false; error: ListingIngestError };

/**
 * Validates the host of a pasted listing URL.
 *
 * Returns the matched host string on success, or a `ListingIngestError`
 * with `kind: "malformed-url"` (no host) or `"unsupported-host"`
 * (host present but not on the allowlist).
 */
export function resolveListingHost(rawUrl: string): {
  host: string | null;
  error: ListingIngestError | null;
} {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return {
      host: null,
      error: {
        kind: "malformed-url",
        message: "Please paste a listing URL.",
      },
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      host: null,
      error: {
        kind: "malformed-url",
        message: "That doesn't look like a valid URL.",
      },
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      host: null,
      error: {
        kind: "malformed-url",
        message: "Listing URL must use http:// or https://.",
      },
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!SUPPORTED_LISTING_HOSTS.includes(host as (typeof SUPPORTED_LISTING_HOSTS)[number])) {
    return {
      host: null,
      error: {
        kind: "unsupported-host",
        message: `We don't support ${host} yet. Currently we support Zillow listings only.`,
      },
    };
  }

  return { host, error: null };
}

/**
 * Extracts photo URLs from a fetched listing page's HTML.
 *
 * MVP strategy: Zillow's gallery stores photo URLs in a JSON blob
 * embedded in a `<script>` tag (`"photoUrls"` or
 * `"hiResImageUrls"` arrays). We grab everything that looks like a
 * `https://...jpg` or `...webp` URL inside that blob. Order is the
 * order in which they appear in the source (i.e. listing order,
 * which is the room ordering #1180 is leaving as the MVP default).
 *
 * The output is capped at `PROJECT_CREATE_MAX_ROOMS` and the
 * `truncatedCount` reports how many extras were dropped, so the UI
 * can render a "20 rooms max; 8 extras skipped" message.
 */
export function extractListingPhotos(html: string): {
  photoUrls: string[];
  truncatedCount: number;
} {
  // Strip ONLY NUL and DEL — other control chars (\n, \r, \t) act as
  // legitimate separators between URLs in source HTML and stripping them
  // would concatenate adjacent URLs into one match (the test case pins
  // PROJECT_CREATE_MAX_ROOMS=20 by joining URLs with "\n").
  const cleaned = html.replace(/[\u0000\u007F]/g, "");

  // Zillow photo URLs sit inside the `"imageUrls"` / `"hiResImageUrls"`
  // arrays in the page's embedded JSON. The page may also embed full
  // https URLs inline outside those arrays (open-graph tags, etc) —
  // those are filtered by the minimum length + extension match below.
  // Use the global match with a negative lookbehind to avoid grabbing
  // trailing characters that get concatenated to a preceding URL when
  // the page serializes JSON without separators (e.g. `"jpg","https:...`).
  const matches =
    cleaned.match(/https:\/\/[^\s"'\\()<>,]+\.(?:jpg|jpeg|png|webp)/gi) ?? [];

  // De-dupe while preserving order so the first gallery slot wins.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of matches) {
    if (seen.has(url)) continue;
    seen.add(url);
    deduped.push(url);
  }

  if (deduped.length <= PROJECT_CREATE_MAX_ROOMS) {
    return { photoUrls: deduped, truncatedCount: 0 };
  }
  return {
    photoUrls: deduped.slice(0, PROJECT_CREATE_MAX_ROOMS),
    truncatedCount: deduped.length - PROJECT_CREATE_MAX_ROOMS,
  };
}

/**
 * Extracts a street address from the listing page's HTML.
 *
 * MVP strategy: look for the first occurrence of an address-shaped
 * `<meta property="og:title">` content, Zillow's
 * `"streetAddress"` JSON field, or a JSON-LD `"address"` block. We
 * don't try to be clever about apartment numbers / unit suffixes —
 * if no match is found we return null and let the user type one.
 */
export function extractListingAddress(html: string): string | null {
  const cleaned = html.replace(/[\u0000\u007F]/g, "");

  // 1) og:title meta tag — Zillow uses "123 Main St, City, ST 12345".
  const ogTitle =
    cleaned.match(/<meta\s+property\s*=\s*["']og:title["']\s+content\s*=\s*["']([^"']+)["']/i) ??
    cleaned.match(/<meta\s+content\s*=\s*["']([^"']+)["']\s+property\s*=\s*["']og:title["']/i);
  if (ogTitle?.[1]) {
    const candidate = decodeEntities(ogTitle[1]).trim();
    // og:title often ends with "| Zillow" or " - Zillow" or " | Realtor.com"
    // — strip the suffix and any " — " / " - " separator that follows the
    // address so the user just sees the street address line.
    const strippedSuffix = candidate
      .replace(/\s*[|—–\-]\s*(Zillow|Realtor\.com|Redfin|Trulia)\s*$/i, "")
      .trim();
    if (looksLikeAddress(strippedSuffix)) {
      return strippedSuffix;
    }
  }

  // 2) JSON-LD address block ("streetAddress" + "addressRegion" + "postalCode").
  const ldMatch = cleaned.match(
    /"streetAddress"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[\s\S]{0,200}?"addressRegion"\s*:\s*"([A-Z]{2})"[\s\S]{0,200}?"postalCode"\s*:\s*"([\d-]+)"/
  );
  if (ldMatch) {
    return `${ldMatch[1]}, ${ldMatch[2]} ${ldMatch[3]}`.trim();
  }

  // 3) Zillow's "streetAddress" field, paired with "city"/"state"/"zipcode".
  const zillowMatch = cleaned.match(
    /"streetAddress"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"city"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"state"\s*:\s*"([A-Z]{2})"\s*,\s*"zipcode"\s*:\s*"([\d-]+)"/
  );
  if (zillowMatch) {
    return `${zillowMatch[1]}, ${zillowMatch[2]}, ${zillowMatch[3]} ${zillowMatch[4]}`.trim();
  }

  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Permissive address test. A real "is this a US address" check needs a
 * geocoder, but for the MVP we accept strings that contain a digit
 * followed by some words (street name) plus a comma+state-or-zip at
 * the end. Returns false for empty / pure-text matches.
 */
function looksLikeAddress(value: string): boolean {
  if (!value) return false;
  return /\d/.test(value) && /[A-Za-z]{2}/.test(value) && value.length >= 5;
}

/**
 * Fetches a listing page and extracts the photo set + address.
 *
 * Pure-shaped: takes a `fetcher` function (so tests can supply a fake
 * without monkey-patching `globalThis.fetch`) and returns the typed
 * result. Network failures (`fetch` rejects, response not ok) surface
 * as `kind: "external-service-error"`-style errors the route layer
 * maps to a 502.
 */
export interface FetchListingInput {
  rawUrl: string;
  fetcher: typeof fetch;
  /**
   * robots.txt policy gate. Zillow's TOS reserves scraping rights;
   * until a partner API is in place we surface a "blocked" result for
   * the host and let the caller render a "coming soon" message. Tests
   * pass `false` to bypass.
   */
  allowedByPolicy: boolean;
}

export type FetchListingFailureKind =
  | ListingIngestErrorKind
  | "external-service-error";

export type FetchListingResult =
  | { ok: true; preview: ListingIngestPreview }
  | { ok: false; error: ListingIngestError & { kind: FetchListingFailureKind } };

export async function fetchListingPreview(
  input: FetchListingInput
): Promise<FetchListingResult> {
  if (!input.allowedByPolicy) {
    return {
      ok: false,
      error: {
        kind: "blocked-by-robots",
        message:
          "We can't pull photos from this site yet (terms of service). Currently we support Zillow listings.",
      },
    };
  }

  const { host, error: hostError } = resolveListingHost(input.rawUrl);
  if (hostError) {
    return {
      ok: false,
      error: { ...hostError, kind: hostError.kind as FetchListingFailureKind },
    };
  }

  let response: Response;
  try {
    response = await input.fetcher(input.rawUrl, {
      headers: {
        // Pass through a UA that looks like a normal shopper so the
        // listing returns the photo-rich SSR blob (some hosts return
        // a JS-only shell to known scraper UAs).
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    return {
      ok: false,
      error: {
        kind: "external-service-error",
        message: "We couldn't reach that listing. Check the URL and try again.",
      },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "external-service-error",
        // Include the status code in the message so callers (and tests)
        // can distinguish a 503 from a 404 from a 5xx upstream without
        // adding another field to the discriminated result shape.
        message: `The listing service returned ${response.status} ${response.statusText}. Please try again.`,
      },
    };
  }

  const html = await response.text();
  const { photoUrls, truncatedCount } = extractListingPhotos(html);
  if (photoUrls.length === 0) {
    return {
      ok: false,
      error: {
        kind: "no-photos",
        message: "We didn't find any photos on that listing.",
      },
    };
  }

  return {
    ok: true,
    preview: {
      host: host!,
      photoUrls,
      propertyAddress: extractListingAddress(html),
      truncatedCount,
    },
  };
}