import { describe, it, expect } from "vitest";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_INVALID_TOKEN,
  API_ERROR_INVALID_PREVIEW_TOKEN,
  API_ERROR_PROJECT_NOT_FOUND,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_REQUEST_NOT_FOUND,
  API_ERROR_USER_NOT_FOUND,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_INVALID_SIGNATURE,
  API_ERROR_INVALID_PROJECT,
  API_ERROR_INVALID_CONCEPT,
  API_ERROR_ALREADY_SIGNED,
  API_ERROR_SAVE_FAILED,
  API_ERROR_SETUP_REQUIRED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_TOO_MANY_REQUESTS,
  API_ERROR_PDF_GENERATION_FAILED,
  API_ERROR_PDF_AUTHENTICATION_FAILED,
  API_ERROR_EXPORT_FAILED,
  API_ERROR_COPY_GENERATION_FAILED,
  API_ERROR_INPAINT_SUBMIT_FAILED,
  API_ERROR_INPAINT_FETCH_FAILED,
  API_ERROR_INPAINT_STATUS_FAILED,
  API_ERROR_INPAINT_TERMINAL,
  API_ERROR_SEGMENTATION_FAILED,
  API_ERROR_DETECTION_FAILED,
  API_ERROR_CONFIGURATION_MISSING,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";

describe("API error constants", () => {
  /* ─── Auth / Session ─────────────────────────────────────────────────────── */
  describe("Auth / Session errors", () => {
    it("API_ERROR_UNAUTHORIZED is a non-empty string", () => {
      expect(typeof API_ERROR_UNAUTHORIZED).toBe("string");
      expect(API_ERROR_UNAUTHORIZED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_TOKEN is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_TOKEN).toBe("string");
      expect(API_ERROR_INVALID_TOKEN.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_PREVIEW_TOKEN is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_PREVIEW_TOKEN).toBe("string");
      expect(API_ERROR_INVALID_PREVIEW_TOKEN.length).toBeGreaterThan(0);
    });
  });

  /* ─── Resource Not Found ─────────────────────────────────────────────────── */
  describe("Resource Not Found errors", () => {
    it("API_ERROR_PROJECT_NOT_FOUND is a non-empty string", () => {
      expect(typeof API_ERROR_PROJECT_NOT_FOUND).toBe("string");
      expect(API_ERROR_PROJECT_NOT_FOUND.length).toBeGreaterThan(0);
    });

    it("API_ERROR_ROOM_NOT_FOUND is a non-empty string", () => {
      expect(typeof API_ERROR_ROOM_NOT_FOUND).toBe("string");
      expect(API_ERROR_ROOM_NOT_FOUND.length).toBeGreaterThan(0);
    });

    it("API_ERROR_REQUEST_NOT_FOUND is a non-empty string", () => {
      expect(typeof API_ERROR_REQUEST_NOT_FOUND).toBe("string");
      expect(API_ERROR_REQUEST_NOT_FOUND.length).toBeGreaterThan(0);
    });

    it("API_ERROR_USER_NOT_FOUND is a non-empty string", () => {
      expect(typeof API_ERROR_USER_NOT_FOUND).toBe("string");
      expect(API_ERROR_USER_NOT_FOUND.length).toBeGreaterThan(0);
    });
  });

  /* ─── Validation / Input ──────────────────────────────────────────────────── */
  describe("Validation / Input errors", () => {
    it("API_ERROR_MISSING_REQUIRED_FIELDS is a non-empty string", () => {
      expect(typeof API_ERROR_MISSING_REQUIRED_FIELDS).toBe("string");
      expect(API_ERROR_MISSING_REQUIRED_FIELDS.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_REQUEST is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_REQUEST).toBe("string");
      expect(API_ERROR_INVALID_REQUEST.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_SIGNATURE is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_SIGNATURE).toBe("string");
      expect(API_ERROR_INVALID_SIGNATURE.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_PROJECT is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_PROJECT).toBe("string");
      expect(API_ERROR_INVALID_PROJECT.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INVALID_CONCEPT is a non-empty string", () => {
      expect(typeof API_ERROR_INVALID_CONCEPT).toBe("string");
      expect(API_ERROR_INVALID_CONCEPT.length).toBeGreaterThan(0);
    });
  });

  /* ─── Business Logic ──────────────────────────────────────────────────────── */
  describe("Business Logic errors", () => {
    it("API_ERROR_ALREADY_SIGNED is a non-empty string", () => {
      expect(typeof API_ERROR_ALREADY_SIGNED).toBe("string");
      expect(API_ERROR_ALREADY_SIGNED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_SAVE_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_SAVE_FAILED).toBe("string");
      expect(API_ERROR_SAVE_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_SETUP_REQUIRED is a non-empty string", () => {
      expect(typeof API_ERROR_SETUP_REQUIRED).toBe("string");
      expect(API_ERROR_SETUP_REQUIRED.length).toBeGreaterThan(0);
    });
  });

  /* ─── Quota / Rate Limit ─────────────────────────────────────────────────── */
  describe("Quota / Rate Limit errors", () => {
    it("API_ERROR_RATE_LIMIT_EXCEEDED is a non-empty string", () => {
      expect(typeof API_ERROR_RATE_LIMIT_EXCEEDED).toBe("string");
      expect(API_ERROR_RATE_LIMIT_EXCEEDED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_TOO_MANY_REQUESTS is a non-empty string", () => {
      expect(typeof API_ERROR_TOO_MANY_REQUESTS).toBe("string");
      expect(API_ERROR_TOO_MANY_REQUESTS.length).toBeGreaterThan(0);
    });
  });

  /* ─── Third-Party / Integration ───────────────────────────────────────────── */
  describe("Third-Party / Integration errors", () => {
    it("API_ERROR_PDF_GENERATION_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_PDF_GENERATION_FAILED).toBe("string");
      expect(API_ERROR_PDF_GENERATION_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_PDF_AUTHENTICATION_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_PDF_AUTHENTICATION_FAILED).toBe("string");
      expect(API_ERROR_PDF_AUTHENTICATION_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_EXPORT_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_EXPORT_FAILED).toBe("string");
      expect(API_ERROR_EXPORT_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_COPY_GENERATION_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_COPY_GENERATION_FAILED).toBe("string");
      expect(API_ERROR_COPY_GENERATION_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INPAINT_SUBMIT_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_INPAINT_SUBMIT_FAILED).toBe("string");
      expect(API_ERROR_INPAINT_SUBMIT_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INPAINT_FETCH_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_INPAINT_FETCH_FAILED).toBe("string");
      expect(API_ERROR_INPAINT_FETCH_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INPAINT_STATUS_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_INPAINT_STATUS_FAILED).toBe("string");
      expect(API_ERROR_INPAINT_STATUS_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_INPAINT_TERMINAL is a non-empty string", () => {
      expect(typeof API_ERROR_INPAINT_TERMINAL).toBe("string");
      expect(API_ERROR_INPAINT_TERMINAL.length).toBeGreaterThan(0);
    });

    it("API_ERROR_SEGMENTATION_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_SEGMENTATION_FAILED).toBe("string");
      expect(API_ERROR_SEGMENTATION_FAILED.length).toBeGreaterThan(0);
    });

    it("API_ERROR_DETECTION_FAILED is a non-empty string", () => {
      expect(typeof API_ERROR_DETECTION_FAILED).toBe("string");
      expect(API_ERROR_DETECTION_FAILED.length).toBeGreaterThan(0);
    });
  });

  /* ─── Configuration ────────────────────────────────────────────────────────── */
  describe("Configuration errors", () => {
    it("API_ERROR_CONFIGURATION_MISSING is a non-empty string", () => {
      expect(typeof API_ERROR_CONFIGURATION_MISSING).toBe("string");
      expect(API_ERROR_CONFIGURATION_MISSING.length).toBeGreaterThan(0);
    });
  });

  /* ─── Server / Unknown ───────────────────────────────────────────────────── */
  describe("Server / Unknown errors", () => {
    it("API_ERROR_INTERNAL_SERVER is a non-empty string", () => {
      expect(typeof API_ERROR_INTERNAL_SERVER).toBe("string");
      expect(API_ERROR_INTERNAL_SERVER.length).toBeGreaterThan(0);
    });
  });

  /* ─── Error code format validation ───────────────────────────────────────── */
  describe("Error code format", () => {
    it("all error codes use kebab-case format", () => {
      const allErrors = [
        API_ERROR_UNAUTHORIZED,
        API_ERROR_INVALID_TOKEN,
        API_ERROR_INVALID_PREVIEW_TOKEN,
        API_ERROR_PROJECT_NOT_FOUND,
        API_ERROR_ROOM_NOT_FOUND,
        API_ERROR_REQUEST_NOT_FOUND,
        API_ERROR_USER_NOT_FOUND,
        API_ERROR_MISSING_REQUIRED_FIELDS,
        API_ERROR_INVALID_REQUEST,
        API_ERROR_INVALID_SIGNATURE,
        API_ERROR_INVALID_PROJECT,
        API_ERROR_INVALID_CONCEPT,
        API_ERROR_ALREADY_SIGNED,
        API_ERROR_SAVE_FAILED,
        API_ERROR_SETUP_REQUIRED,
        API_ERROR_RATE_LIMIT_EXCEEDED,
        API_ERROR_TOO_MANY_REQUESTS,
        API_ERROR_PDF_GENERATION_FAILED,
        API_ERROR_PDF_AUTHENTICATION_FAILED,
        API_ERROR_EXPORT_FAILED,
        API_ERROR_COPY_GENERATION_FAILED,
        API_ERROR_INPAINT_SUBMIT_FAILED,
        API_ERROR_INPAINT_FETCH_FAILED,
        API_ERROR_INPAINT_STATUS_FAILED,
        API_ERROR_INPAINT_TERMINAL,
        API_ERROR_SEGMENTATION_FAILED,
        API_ERROR_DETECTION_FAILED,
        API_ERROR_CONFIGURATION_MISSING,
        API_ERROR_INTERNAL_SERVER,
      ];

      for (const code of allErrors) {
        expect(code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it("all error codes are unique", () => {
      const allErrors = [
        API_ERROR_UNAUTHORIZED,
        API_ERROR_INVALID_TOKEN,
        API_ERROR_INVALID_PREVIEW_TOKEN,
        API_ERROR_PROJECT_NOT_FOUND,
        API_ERROR_ROOM_NOT_FOUND,
        API_ERROR_REQUEST_NOT_FOUND,
        API_ERROR_USER_NOT_FOUND,
        API_ERROR_MISSING_REQUIRED_FIELDS,
        API_ERROR_INVALID_REQUEST,
        API_ERROR_INVALID_SIGNATURE,
        API_ERROR_INVALID_PROJECT,
        API_ERROR_INVALID_CONCEPT,
        API_ERROR_ALREADY_SIGNED,
        API_ERROR_SAVE_FAILED,
        API_ERROR_SETUP_REQUIRED,
        API_ERROR_RATE_LIMIT_EXCEEDED,
        API_ERROR_TOO_MANY_REQUESTS,
        API_ERROR_PDF_GENERATION_FAILED,
        API_ERROR_PDF_AUTHENTICATION_FAILED,
        API_ERROR_EXPORT_FAILED,
        API_ERROR_COPY_GENERATION_FAILED,
        API_ERROR_INPAINT_SUBMIT_FAILED,
        API_ERROR_INPAINT_FETCH_FAILED,
        API_ERROR_INPAINT_STATUS_FAILED,
        API_ERROR_INPAINT_TERMINAL,
        API_ERROR_SEGMENTATION_FAILED,
        API_ERROR_DETECTION_FAILED,
        API_ERROR_CONFIGURATION_MISSING,
        API_ERROR_INTERNAL_SERVER,
      ];

      const uniqueErrors = new Set(allErrors);
      expect(uniqueErrors.size).toBe(allErrors.length);
    });
  });
});
