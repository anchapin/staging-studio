import { describe, it, expect } from "vitest";
import {
  CURRENT_API_VERSION,
  VERSION_HEADER,
  DEPRECATION_HEADER,
  SUNSET_HEADER,
  parseApiVersion,
  buildDeprecationHeaders,
  buildVersionHeaders,
} from "@/lib/api-version";

describe("api-version", () => {
  describe("parseApiVersion", () => {
    it("returns v1 when URL includes /api/v1/", () => {
      const req = new Request("http://localhost/api/v1/rooms");
      const result = parseApiVersion(req);
      expect(result.version).toBe("v1");
      expect(result.isDeprecated).toBe(false);
      expect(result.sunsetDate).toBeNull();
    });

    it("returns v1 when Accept header includes vnd.stagingstudio.v1", () => {
      const req = new Request("http://localhost/api/rooms", {
        headers: { Accept: "application/vnd.stagingstudio.v1+json" },
      });
      const result = parseApiVersion(req);
      expect(result.version).toBe("v1");
      expect(result.isDeprecated).toBe(false);
      expect(result.sunsetDate).toBeNull();
    });

    it("returns v1 from Accept header even when URL is not v1", () => {
      const req = new Request("http://localhost/api/rooms", {
        headers: { Accept: "application/json, application/vnd.stagingstudio.v1+json" },
      });
      const result = parseApiVersion(req);
      expect(result.version).toBe("v1");
      expect(result.isDeprecated).toBe(false);
    });

    it("returns unversioned and deprecated for /api/ routes without v1", () => {
      const req = new Request("http://localhost/api/rooms");
      const result = parseApiVersion(req);
      expect(result.version).toBe("unversioned");
      expect(result.isDeprecated).toBe(true);
      expect(result.sunsetDate).not.toBeNull();
    });

    it("returns unversioned without deprecation for non-API routes", () => {
      const req = new Request("http://localhost/dashboard");
      const result = parseApiVersion(req);
      expect(result.version).toBe("unversioned");
      expect(result.isDeprecated).toBe(false);
      expect(result.sunsetDate).toBeNull();
    });

    it("returns unversioned without deprecation for root path", () => {
      const req = new Request("http://localhost/");
      const result = parseApiVersion(req);
      expect(result.version).toBe("unversioned");
      expect(result.isDeprecated).toBe(false);
      expect(result.sunsetDate).toBeNull();
    });

    it("handles Request with null url", () => {
      const req = new Request("http://localhost/api/v1/rooms");
      const result = parseApiVersion(req);
      expect(result.version).toBe("v1");
    });

    it("handles Request with empty Accept header", () => {
      const req = new Request("http://localhost/api/rooms", {
        headers: { Accept: "" },
      });
      const result = parseApiVersion(req);
      expect(result.version).toBe("unversioned");
      expect(result.isDeprecated).toBe(true);
    });

    it("v1 URL takes priority over unversioned API deprecation", () => {
      const req = new Request("http://localhost/api/v1/rooms");
      const result = parseApiVersion(req);
      expect(result.version).toBe("v1");
      expect(result.isDeprecated).toBe(false);
    });
  });

  describe("buildDeprecationHeaders", () => {
    it("returns all required deprecation headers", () => {
      const headers = buildDeprecationHeaders();

      expect(headers).toHaveProperty(DEPRECATION_HEADER);
      expect(headers).toHaveProperty(SUNSET_HEADER);
      expect(headers).toHaveProperty(VERSION_HEADER);
      expect(headers).toHaveProperty("Link");
    });

    it("sets Deprecation header to true with deprecation rel", () => {
      const headers = buildDeprecationHeaders();
      expect(headers[DEPRECATION_HEADER]).toBe('true; rel="deprecation"');
    });

    it("sets Sunset header to a valid UTC date string", () => {
      const headers = buildDeprecationHeaders();
      const sunsetDate = new Date(headers[SUNSET_HEADER]);
      expect(sunsetDate.toUTCString()).toBe(headers[SUNSET_HEADER]);
    });

    it("sets Version header to unversioned", () => {
      const headers = buildDeprecationHeaders();
      expect(headers[VERSION_HEADER]).toBe("unversioned");
    });

    it("sets Link header to v1 successor", () => {
      const headers = buildDeprecationHeaders();
      expect(headers["Link"]).toBe('</api/v1>; rel="successor-version"');
    });
  });

  describe("buildVersionHeaders", () => {
    it("uses CURRENT_API_VERSION by default", () => {
      const headers = buildVersionHeaders();
      expect(headers[VERSION_HEADER]).toBe(CURRENT_API_VERSION);
    });

    it("uses v1 when passed v1", () => {
      const headers = buildVersionHeaders("v1");
      expect(headers[VERSION_HEADER]).toBe("v1");
    });

    it("uses unversioned when passed unversioned", () => {
      const headers = buildVersionHeaders("unversioned");
      expect(headers[VERSION_HEADER]).toBe("unversioned");
    });
  });

  describe("constants", () => {
    it("CURRENT_API_VERSION is v1", () => {
      expect(CURRENT_API_VERSION).toBe("v1");
    });

    it("VERSION_HEADER is API-Version", () => {
      expect(VERSION_HEADER).toBe("API-Version");
    });

    it("DEPRECATION_HEADER is Deprecation", () => {
      expect(DEPRECATION_HEADER).toBe("Deprecation");
    });

    it("SUNSET_HEADER is Sunset", () => {
      expect(SUNSET_HEADER).toBe("Sunset");
    });
  });
});
