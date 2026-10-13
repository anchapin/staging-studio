/**
 * Listing URL ingestion (issue #1179)
 *
 * Pins the host allowlist, photo/address extraction, and the
 * 20-room cap so a change to either the regex or the cap surfaces as
 * a unit-test failure rather than a "silently dropped photos"
 * surprise at project-create time.
 */

import { describe, expect, it } from "vitest";

import {
  PROJECT_CREATE_MAX_ROOMS,
} from "@/lib/project-create-schema";
import {
  SUPPORTED_LISTING_HOSTS,
  extractListingAddress,
  extractListingPhotos,
  fetchListingPreview,
  resolveListingHost,
} from "@/lib/listing-ingest";

describe("resolveListingHost", () => {
  it("accepts a Zillow URL on the www subdomain", () => {
    const { host, error } = resolveListingHost(
      "https://www.zillow.com/homedetails/123-Main-St/4567_zpid/"
    );
    expect(error).toBeNull();
    expect(host).toBe("www.zillow.com");
  });

  it("accepts the bare zillow.com host (no www)", () => {
    const { host, error } = resolveListingHost("https://zillow.com/homes/foo/");
    expect(error).toBeNull();
    expect(host).toBe("zillow.com");
  });

  it("rejects an empty URL with a malformed-url error", () => {
    const { host, error } = resolveListingHost("   ");
    expect(host).toBeNull();
    expect(error?.kind).toBe("malformed-url");
  });

  it("rejects garbage that doesn't parse as a URL", () => {
    const { error } = resolveListingHost("not a url at all");
    expect(error?.kind).toBe("malformed-url");
  });

  it("rejects non-http protocols", () => {
    const { error } = resolveListingHost("ftp://www.zillow.com/listing");
    expect(error?.kind).toBe("malformed-url");
  });

  it("rejects a host that is not on the supported list", () => {
    const { host, error } = resolveListingHost("https://www.realtor.com/foo");
    expect(host).toBeNull();
    expect(error?.kind).toBe("unsupported-host");
    expect(error?.message.toLowerCase()).toContain("realtor.com");
  });

  it("ignores the host allowlist when the hostname is empty", () => {
    const { host, error } = resolveListingHost("https:///no-host");
    expect(host).toBeNull();
    expect(error?.kind).toBe("unsupported-host");
  });

  it("canonicalizes the hostname to lowercase", () => {
    const { host } = resolveListingHost("https://WWW.ZILLOW.COM/homedetails/123/");
    expect(host).toBe("www.zillow.com");
  });
});

describe("SUPPORTED_LISTING_HOSTS", () => {
  it("lists at least one Zillow variant and no third-party MLS hosts by default", () => {
    expect(SUPPORTED_LISTING_HOSTS.some((h) => h.endsWith("zillow.com"))).toBe(true);
    expect(SUPPORTED_LISTING_HOSTS.some((h) => h.endsWith("realtor.com"))).toBe(false);
    expect(SUPPORTED_LISTING_HOSTS.some((h) => h.endsWith("redfin.com"))).toBe(false);
  });
});

describe("extractListingPhotos", () => {
  it("pulls jpg URLs out of an embedded JSON blob", () => {
    const html = `
      <html><head>
        <script>{"imageUrls":["https://photos.zillowstatic.com/a.jpg","https://photos.zillowstatic.com/b.jpg"]}</script>
      </head><body></body></html>
    `;
    const { photoUrls, truncatedCount } = extractListingPhotos(html);
    expect(photoUrls).toEqual([
      "https://photos.zillowstatic.com/a.jpg",
      "https://photos.zillowstatic.com/b.jpg",
    ]);
    expect(truncatedCount).toBe(0);
  });

  it("also picks up webp and png URLs", () => {
    const html = `
      https://photos.zillowstatic.com/1.webp
      https://photos.zillowstatic.com/2.png
      https://photos.zillowstatic.com/3.jpeg
    `;
    const { photoUrls } = extractListingPhotos(html);
    expect(photoUrls).toHaveLength(3);
    expect(photoUrls[0]).toContain(".webp");
    expect(photoUrls[1]).toContain(".png");
    expect(photoUrls[2]).toContain(".jpeg");
  });

  it("de-duplicates repeats while preserving source order", () => {
    const html = `
      https://photos.zillowstatic.com/a.jpg
      https://photos.zillowstatic.com/b.jpg
      https://photos.zillowstatic.com/a.jpg
    `;
    const { photoUrls } = extractListingPhotos(html);
    expect(photoUrls).toEqual([
      "https://photos.zillowstatic.com/a.jpg",
      "https://photos.zillowstatic.com/b.jpg",
    ]);
  });

  it(`caps the result at PROJECT_CREATE_MAX_ROOMS (${PROJECT_CREATE_MAX_ROOMS}) and reports truncatedCount`, () => {
    const urls = Array.from(
      { length: PROJECT_CREATE_MAX_ROOMS + 8 },
      (_, i) => `https://photos.zillowstatic.com/photo-${i}.jpg`
    ).join("\n");
    const { photoUrls, truncatedCount } = extractListingPhotos(urls);
    expect(photoUrls).toHaveLength(PROJECT_CREATE_MAX_ROOMS);
    expect(truncatedCount).toBe(8);
  });

  it("returns an empty list when the page has no photo URLs", () => {
    const { photoUrls, truncatedCount } = extractListingPhotos(
      "<html><body>No photos here.</body></html>"
    );
    expect(photoUrls).toEqual([]);
    expect(truncatedCount).toBe(0);
  });
});

describe("extractListingAddress", () => {
  it("parses an og:title that follows the Zillow pattern", () => {
    const html = `<meta property="og:title" content="123 Main St, Springfield, IL 62701 | Zillow" />`;
    expect(extractListingAddress(html)).toBe("123 Main St, Springfield, IL 62701");
  });

  it("parses the JSON-LD streetAddress block", () => {
    const html = `
      {"@type":"Residence","address":{"@type":"PostalAddress",
        "streetAddress":"742 Evergreen Ter",
        "addressLocality":"Springfield",
        "addressRegion":"IL",
        "postalCode":"62701"}}
    `;
    const address = extractListingAddress(html);
    expect(address).toBe("742 Evergreen Ter, IL 62701");
  });

  it("parses Zillow's flat streetAddress/city/state/zipcode fields", () => {
    const html = `
      "streetAddress":"1506 Porters Mill Ter",
      "city":"Midlothian",
      "state":"VA",
      "zipcode":"23112"
    `;
    const address = extractListingAddress(html);
    expect(address).toBe("1506 Porters Mill Ter, Midlothian, VA 23112");
  });

  it("returns null when no address-shaped string is present", () => {
    expect(extractListingAddress("<html>no address at all</html>")).toBeNull();
  });
});

describe("fetchListingPreview", () => {
  function makeOkFetcher(html: string, status = 200): typeof fetch {
    return (async () =>
      new Response(html, {
        status,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
  }

  function makeRejectingFetcher(): typeof fetch {
    return (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
  }

  it("returns a successful preview for a well-formed Zillow page", async () => {
    const html = `
      <meta property="og:title" content="42 Oak Ave, Springfield, IL 62701 | Zillow" />
      <script>
        {"imageUrls":[
          "https://photos.zillowstatic.com/a.jpg",
          "https://photos.zillowstatic.com/b.jpg"
        ]}
      </script>
    `;
    const result = await fetchListingPreview({
      rawUrl: "https://www.zillow.com/homedetails/42-Oak-Ave/123_zpid/",
      fetcher: makeOkFetcher(html),
      allowedByPolicy: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.host).toBe("www.zillow.com");
    expect(result.preview.propertyAddress).toBe("42 Oak Ave, Springfield, IL 62701");
    expect(result.preview.photoUrls).toHaveLength(2);
    expect(result.preview.truncatedCount).toBe(0);
  });

  it("returns blocked-by-robots without calling the fetcher", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await fetchListingPreview({
      rawUrl: "https://www.zillow.com/homedetails/42/123_zpid/",
      fetcher,
      allowedByPolicy: false,
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("blocked-by-robots");
  });

  it("propagates host errors before reaching the fetcher", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await fetchListingPreview({
      rawUrl: "https://www.realtor.com/foo",
      fetcher,
      allowedByPolicy: true,
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported-host");
  });

  it("returns external-service-error when the fetcher rejects", async () => {
    const result = await fetchListingPreview({
      rawUrl: "https://www.zillow.com/homedetails/42/123_zpid/",
      fetcher: makeRejectingFetcher(),
      allowedByPolicy: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("external-service-error");
  });

  it("returns external-service-error on a non-2xx response", async () => {
    const result = await fetchListingPreview({
      rawUrl: "https://www.zillow.com/homedetails/42/123_zpid/",
      // `makeOkFetcher(html, status = 200)` accepts the numeric status as
      // its second positional arg — pass `503` directly, not `{ status: 503 }`.
      fetcher: makeOkFetcher("", 503),
      allowedByPolicy: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("external-service-error");
    expect(result.error.message).toContain("503");
  });

  it("returns no-photos when the page contains zero image URLs", async () => {
    const result = await fetchListingPreview({
      rawUrl: "https://www.zillow.com/homedetails/42/123_zpid/",
      fetcher: makeOkFetcher("<html>blank page</html>"),
      allowedByPolicy: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("no-photos");
  });
});