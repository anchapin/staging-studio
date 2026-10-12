import { beforeEach, describe, expect, it } from "vitest";

import {
  getBrowserLocalStorage,
  readZenHintShown,
  readZenModePreference,
  writeZenHintShown,
  writeZenModePreference,
  ZEN_MODE_PREFERENCE_KEY,
} from "@/lib/zen-preference";

/** In-memory stand-in for localStorage. */
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

/** A storage whose every method throws (privacy-blocked storage). */
function makeThrowingStorage() {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("readZenModePreference", () => {
  it("returns null for null/undefined storage (SSR)", () => {
    expect(readZenModePreference(null)).toBeNull();
    expect(readZenModePreference(undefined)).toBeNull();
  });

  it("returns null when no choice was stored", () => {
    expect(readZenModePreference(makeStorage())).toBeNull();
  });

  it("parses stored true/false choices", () => {
    expect(readZenModePreference(makeStorage({ [ZEN_MODE_PREFERENCE_KEY]: "true" }))).toBe(true);
    expect(readZenModePreference(makeStorage({ [ZEN_MODE_PREFERENCE_KEY]: "false" }))).toBe(false);
  });

  it("returns null for a garbage stored value", () => {
    expect(readZenModePreference(makeStorage({ [ZEN_MODE_PREFERENCE_KEY]: "yes" }))).toBeNull();
    expect(readZenModePreference(makeStorage({ [ZEN_MODE_PREFERENCE_KEY]: "" }))).toBeNull();
  });

  it("returns null when storage access throws", () => {
    expect(readZenModePreference(makeThrowingStorage())).toBeNull();
  });
});

describe("writeZenModePreference", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("round-trips both choices", () => {
    writeZenModePreference(storage, true);
    expect(readZenModePreference(storage)).toBe(true);
    writeZenModePreference(storage, false);
    expect(readZenModePreference(storage)).toBe(false);
  });

  it("swallows storage failures", () => {
    expect(() => writeZenModePreference(makeThrowingStorage(), true)).not.toThrow();
    expect(() => writeZenModePreference(null, true)).not.toThrow();
  });
});

describe("zen hint flag", () => {
  it("defaults to not shown, then round-trips", () => {
    const storage = makeStorage();
    expect(readZenHintShown(storage)).toBe(false);
    expect(readZenHintShown(null)).toBe(false);
    writeZenHintShown(storage);
    expect(readZenHintShown(storage)).toBe(true);
  });

  it("treats a throwing storage as not shown and swallows writes", () => {
    expect(readZenHintShown(makeThrowingStorage())).toBe(false);
    expect(() => writeZenHintShown(makeThrowingStorage())).not.toThrow();
  });
});

describe("getBrowserLocalStorage", () => {
  it("returns null outside a browser (no window)", () => {
    // Node test environment: window is undefined.
    expect(typeof window).toBe("undefined");
    expect(getBrowserLocalStorage()).toBeNull();
  });
});
