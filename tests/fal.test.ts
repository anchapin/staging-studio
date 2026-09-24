import { describe, expect, it } from "vitest";

import { assertFalConfigured } from "@/lib/fal";
import { MissingEnvVarsError } from "@/lib/env";

describe("assertFalConfigured", () => {
  it("passes when FAL_KEY is set to a non-blank value", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "fk-test-key-123";
    try {
      expect(() => assertFalConfigured()).not.toThrow();
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is undefined", () => {
    const original = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is an empty string", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "";
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is only whitespace", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "   ";
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("error message names FAL_KEY", () => {
    const original = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      expect(() => assertFalConfigured()).toThrow(/FAL_KEY/);
    } finally {
      process.env.FAL_KEY = original;
    }
  });
});
