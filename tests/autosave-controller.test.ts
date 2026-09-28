import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveController } from "@/lib/autosave-controller";

describe("AutosaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once after the ~1s idle window following an edit", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("revised copy");
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("revised copy");
  });

  it("debounces rapid edits into one save carrying the last payload", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("draft one");
    await vi.advanceTimersByTimeAsync(600);
    controller.edit("draft two");
    await vi.advanceTimersByTimeAsync(600);
    controller.edit("final text");
    await vi.advanceTimersByTimeAsync(1000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("final text");
  });

  it("blur saves immediately and cancels the pending idle save", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("blurred text");
    controller.blur();
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("blurred text");
  });

  it("chains a second save for an edit made during an in-flight save", async () => {
    let releaseFirst: (v: boolean) => void = () => {};
    const save = vi
      .fn<(payload: string) => Promise<boolean>>()
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (releaseFirst = resolve))
      )
      .mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("first");
    controller.blur();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    controller.edit("second");
    releaseFirst(true);
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("second");
  });

  it("flush forces the scheduled save now and resolves true once written", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("flushed text");
    const flushed = controller.flush();
    expect(save).toHaveBeenCalledTimes(1);

    await expect(flushed).resolves.toBe(true);
  });

  it("surfaces a failed save as error, reports flush false, and retry recovers", async () => {
    const save = vi
      .fn<(payload: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const statuses: string[] = [];
    const controller = new AutosaveController<string>({
      save,
      onStatusChange: (s) => statuses.push(s),
    });

    controller.edit("doomed first");
    const flushed = controller.flush();
    await expect(flushed).resolves.toBe(false);
    expect(controller.status).toBe("error");

    controller.retry();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("saved");
    expect(statuses).toContain("error");
  });

  it("emits the dirty → saving → saved transition sequence", async () => {
    const statuses: string[] = [];
    const controller = new AutosaveController<string>({
      save: async () => true,
      onStatusChange: (s) => statuses.push(s),
    });

    controller.edit("status probe");
    await vi.advanceTimersByTimeAsync(1000);

    expect(statuses).toEqual(["dirty", "saving", "saved"]);
  });

  // Issue #1083: a Next.js server action whose fetch was aborted during
  // revalidation rejects the client-side action promise. The autosave
  // controller's save() then throws — flush() must still resolve (false,
  // not hang forever) so the caller can decide whether to surface the
  // failure instead of leaving the UI stuck in Edit mode.
  it("flush resolves false (does not hang) when save() throws", async () => {
    const save = vi
      .fn<(payload: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("net::ERR_ABORTED"))
      .mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("aborted save");

    const flushed = controller.flush();
    // Race the flush against a fake-timer microtask flush so a hang
    // would surface as a test-timeout rather than passing silently.
    await expect(flushed).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.status).toBe("error");

    // retry() must still recover — the failed payload is preserved.
    controller.retry();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("saved");
  });

  it("an aborted-save retry chains a fresh in-flight save without leaking state", async () => {
    const save = vi
      .fn<(payload: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("net::ERR_ABORTED"))
      .mockResolvedValue(true);
    const controller = new AutosaveController<string>({ save });

    controller.edit("first try");
    await controller.flush();
    expect(controller.status).toBe("error");

    // A retry must reset inFlight so a follow-up edit() / flush() can
    // start a new save cleanly — no leaking the previous aborted run().
    controller.edit("second try");
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("second try");
    expect(controller.status).toBe("saved");
  });
});
