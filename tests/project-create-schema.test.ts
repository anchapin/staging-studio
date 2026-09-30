/**
 * Project create-request validation (issue #1134)
 *
 * Pins the write-side schema for POST /api/projects and the read-side
 * narrowing the print page uses, because a malformed `buyerDemographics`
 * row throws inside the page Browserless renders and fails the PDF
 * export for the entire lookbook.
 */

import { describe, expect, it } from "vitest";

import {
  PROJECT_CREATE_MAX_ROOMS,
  parseBuyerDemographics,
  projectCreateRequestSchema,
} from "@/lib/project-create-schema";

const VALID_DEMOGRAPHICS = {
  buyerType: "downsizing_retiree",
  designPreferences: ["transitional", "traditional"],
  budgetMin: 400,
  budgetMax: 650,
  mustHaveFeatures: ["master_suite"],
  sellTimeline: "30_60_days",
};

const VALID_BODY = {
  propertyAddress: "1506 Porters Mill Ter, Midlothian",
  clientName: "Hartwell",
  targetBuyer: "Empty-nesters downsizing",
  stagingAesthetic: "Vintage Modern",
  rooms: ["Living Room", "Bedroom"],
  buyerDemographics: VALID_DEMOGRAPHICS,
};

function omit<T extends Record<string, unknown>>(value: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...value };
  delete copy[key];
  return copy;
}

describe("projectCreateRequestSchema", () => {
  it("accepts a well-formed intake body", () => {
    const parsed = projectCreateRequestSchema.safeParse(VALID_BODY);
    expect(parsed.success).toBe(true);
  });

  it("defaults rooms to an empty list when omitted", () => {
    const withoutRooms = omit(VALID_BODY, "rooms");
    const parsed = projectCreateRequestSchema.safeParse(withoutRooms);
    expect(parsed.success && parsed.data.rooms).toEqual([]);
  });

  it("rejects a non-array rooms value instead of throwing at Prisma", () => {
    expect(
      projectCreateRequestSchema.safeParse({ ...VALID_BODY, rooms: "Living Room" }).success
    ).toBe(false);
  });

  it("caps the number of rooms one request can create", () => {
    const rooms = Array.from({ length: PROJECT_CREATE_MAX_ROOMS + 1 }, (_, i) => `Room ${i}`);
    expect(projectCreateRequestSchema.safeParse({ ...VALID_BODY, rooms }).success).toBe(false);
  });

  it("rejects unknown keys so a crafted payload cannot write a persisted column", () => {
    expect(
      projectCreateRequestSchema.safeParse({ ...VALID_BODY, userId: "someone-else" }).success
    ).toBe(false);
  });

  it("rejects each required text field when missing or empty", () => {
    for (const field of ["propertyAddress", "clientName", "targetBuyer", "stagingAesthetic"]) {
      expect(
        projectCreateRequestSchema.safeParse({ ...VALID_BODY, [field]: "" }).success
      ).toBe(false);
    }
  });

  it("accepts an omitted buyerDemographics (the persona page is optional)", () => {
    const withoutDemographics = omit(VALID_BODY, "buyerDemographics");
    expect(projectCreateRequestSchema.safeParse(withoutDemographics).success).toBe(true);
  });

  it("rejects a buyerDemographics whose array fields are not arrays", () => {
    const parsed = projectCreateRequestSchema.safeParse({
      ...VALID_BODY,
      buyerDemographics: { ...VALID_DEMOGRAPHICS, designPreferences: "transitional" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a buyerDemographics whose budget fields are not numbers", () => {
    const parsed = projectCreateRequestSchema.safeParse({
      ...VALID_BODY,
      buyerDemographics: { ...VALID_DEMOGRAPHICS, budgetMin: "400" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseBuyerDemographics (read side)", () => {
  it("returns the value when it matches the shape the persona page renders", () => {
    expect(parseBuyerDemographics(VALID_DEMOGRAPHICS)).toEqual(VALID_DEMOGRAPHICS);
  });

  it.each([
    ["null", null],
    ["a string", "downsizing_retiree"],
    ["an array", []],
    ["a partial object", { buyerType: "investor" }],
    [
      "designPreferences as a string",
      { ...VALID_DEMOGRAPHICS, designPreferences: "transitional" },
    ],
    [
      "mustHaveFeatures as an object",
      { ...VALID_DEMOGRAPHICS, mustHaveFeatures: { a: 1 } },
    ],
  ])("degrades %s to null rather than letting the print render throw", (_label, value) => {
    expect(parseBuyerDemographics(value)).toBeNull();
  });
});
