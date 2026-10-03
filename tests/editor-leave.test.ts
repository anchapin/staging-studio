import { describe, expect, it, vi } from "vitest";
import {
  LEAVE_WHILE_RUNNING_MESSAGE,
  confirmLeaveEditor,
} from "@/lib/editor-leave";

describe("confirmLeaveEditor (issue #1188)", () => {
  it("leaves without asking when nothing is running", () => {
    const confirm = vi.fn(() => false);
    expect(confirmLeaveEditor({ isProcessing: false, confirm })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("blurs the focused field first so a pending directives edit is flushed", () => {
    const order: string[] = [];
    const activeElement = { blur: vi.fn(() => order.push("blur")) };
    const confirm = vi.fn(() => {
      order.push("confirm");
      return true;
    });
    confirmLeaveEditor({ isProcessing: true, confirm, activeElement });
    expect(activeElement.blur).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["blur", "confirm"]);
  });

  it("asks before leaving while a run is in flight and honours the answer", () => {
    const yes = vi.fn(() => true);
    const no = vi.fn(() => false);
    expect(confirmLeaveEditor({ isProcessing: true, confirm: yes })).toBe(true);
    expect(confirmLeaveEditor({ isProcessing: true, confirm: no })).toBe(false);
    expect(no).toHaveBeenCalledWith(LEAVE_WHILE_RUNNING_MESSAGE);
  });

  it("tolerates a missing or non-blurrable active element", () => {
    const confirm = vi.fn(() => true);
    expect(
      confirmLeaveEditor({ isProcessing: false, confirm, activeElement: null }),
    ).toBe(true);
    expect(
      confirmLeaveEditor({ isProcessing: false, confirm, activeElement: {} }),
    ).toBe(true);
  });
});
