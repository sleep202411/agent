import { describe, expect, it } from "vitest";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";

describe("StoryDraftSnapshotCoordinator", () => {
  it("keeps later edits behind the barrier until the server action captures the saved revision", async () => {
    const coordinator = new StoryDraftSnapshotCoordinator();
    const events: string[] = [];
    let barrier = false;
    let latest = "draft-a";
    let queued: string | null = null;
    let finishSubmit!: () => void;
    let markSubmitStarted!: () => void;
    const submitStarted = new Promise<void>((resolve) => {
      markSubmitStarted = resolve;
    });
    const submitPending = new Promise<void>((resolve) => {
      finishSubmit = resolve;
    });

    const action = coordinator.run({
      setBarrier: (active) => {
        barrier = active;
        events.push(active ? "barrier:on" : "barrier:off");
      },
      captureSnapshot: () => latest,
      waitForIdleSave: async () => {
        events.push("save:idle");
      },
      saveSnapshot: async (snapshot) => {
        events.push(`save:${snapshot}`);
      },
      savedRevision: () => 7,
      submit: async (revision) => {
        events.push(`submit:${revision}`);
        markSubmitStarted();
        await submitPending;
        events.push("submit:captured");
        return "take-1";
      },
      flushAfterRelease: () => {
        if (queued) events.push(`flush:${queued}`);
      },
    });

    await submitStarted;
    latest = "draft-b";
    if (barrier) queued = latest;

    expect(events).toEqual(["barrier:on", "save:idle", "save:draft-a", "submit:7"]);
    finishSubmit();
    await expect(action).resolves.toBe("take-1");
    expect(events).toEqual([
      "barrier:on",
      "save:idle",
      "save:draft-a",
      "submit:7",
      "submit:captured",
      "barrier:off",
      "flush:draft-b",
    ]);
  });

  it("serializes snapshot actions and always releases the barrier after failure", async () => {
    const coordinator = new StoryDraftSnapshotCoordinator();
    const events: string[] = [];
    let revision = 10;
    const steps = (name: string, fail = false) => ({
      setBarrier: (active: boolean) => {
        events.push(`${name}:barrier:${active}`);
      },
      captureSnapshot: () => name,
      waitForIdleSave: async () => undefined,
      saveSnapshot: async () => {
        events.push(`${name}:save`);
      },
      savedRevision: () => revision++,
      submit: async (savedRevision: number) => {
        events.push(`${name}:submit:${savedRevision}`);
        if (fail) throw new Error(`${name} failed`);
        return name;
      },
      flushAfterRelease: () => {
        events.push(`${name}:flush`);
      },
    });

    const first = coordinator.run(steps("first", true));
    const second = coordinator.run(steps("second"));

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual([
      "first:barrier:true",
      "first:save",
      "first:submit:10",
      "first:barrier:false",
      "first:flush",
      "second:barrier:true",
      "second:save",
      "second:submit:11",
      "second:barrier:false",
      "second:flush",
    ]);
  });
});
