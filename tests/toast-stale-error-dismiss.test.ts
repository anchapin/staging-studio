import { describe, expect, it } from "vitest";
import { applyDismissErrorOnSuccess } from "@/lib/toast-stale-error-dismiss";

describe("applyDismissErrorOnSuccess", () => {
  const make = (
    type: "success" | "error" | "info",
    id: string,
  ): { type: "success" | "error" | "info"; id: string } => ({ type, id });

  it("drops prior error toasts when the incoming toast is a success", () => {
    const current = [
      make("error", "e1"),
      make("info", "i1"),
      make("error", "e2"),
    ];
    const incoming = make("success", "s1");

    const result = applyDismissErrorOnSuccess(current, incoming);

    expect(result.map((t) => t.id)).toEqual(["i1", "s1"]);
    expect(result.map((t) => t.type)).toEqual(["info", "success"]);
  });

  it("does not mutate the input array or its entries", () => {
    const current = [make("error", "e1")];
    const snapshot = [...current];
    const incoming = make("success", "s1");

    applyDismissErrorOnSuccess(current, incoming);

    expect(current).toEqual(snapshot);
  });

  it("preserves success and info toasts while dismissing errors", () => {
    const current = [
      make("success", "s0"),
      make("error", "e1"),
      make("info", "i1"),
      make("error", "e2"),
    ];
    const incoming = make("success", "s1");

    const result = applyDismissErrorOnSuccess(current, incoming);

    expect(result.map((t) => t.id)).toEqual(["s0", "i1", "s1"]);
  });

  it("does not dismiss any toasts when the incoming toast is an error", () => {
    const current = [make("success", "s0"), make("info", "i0")];
    const incoming = make("error", "e1");

    const result = applyDismissErrorOnSuccess(current, incoming);

    expect(result.map((t) => t.id)).toEqual(["s0", "i0", "e1"]);
  });

  it("does not dismiss any toasts when the incoming toast is info", () => {
    const current = [make("error", "e1"), make("success", "s0")];
    const incoming = make("info", "i1");

    const result = applyDismissErrorOnSuccess(current, incoming);

    expect(result.map((t) => t.id)).toEqual(["e1", "s0", "i1"]);
  });

  it("is a no-op for a success when there are no error toasts", () => {
    const current = [make("success", "s0"), make("info", "i0")];
    const incoming = make("success", "s1");

    const result = applyDismissErrorOnSuccess(current, incoming);

    expect(result.map((t) => t.id)).toEqual(["s0", "i0", "s1"]);
  });

  it("appends the success even when the list starts empty", () => {
    const incoming = make("success", "s1");

    const result = applyDismissErrorOnSuccess([], incoming);

    expect(result).toEqual([incoming]);
  });
});