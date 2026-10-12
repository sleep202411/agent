import { describe, expect, it, vi } from "vitest";
import { initializeExperienceRuntime } from "@repo/experience-engine";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  createExperienceJourney,
  createExperienceJourneyAnchor,
  recordExperienceJourney,
} from "./experience-journey-model";
import { ExperienceJourneyReplay } from "./experience-journey-replay";

function fixture(paid = true) {
  const manifest = {
    graph: {
      entrySceneId: "scene",
      nodes: [
        {
          sceneId: "scene",
          kind: "scene",
          renderers: [{ instanceId: "text", rendererId: "core.text", layer: 0 }],
          eventBindings: [],
          ...(paid
            ? { access: { key: "paid", communityPointPrice: 20, title: { "en-US": "Scene" } } }
            : {}),
        },
      ],
    },
    stateDefinitions: [],
    assets: [],
    endings: [],
  } as unknown as ExperienceRuntimeManifest;
  const state = initializeExperienceRuntime(manifest, { randomSeed: "entry-seed" });
  const journey = recordExperienceJourney(manifest, createExperienceJourney(manifest), {
    anchor: createExperienceJourneyAnchor(manifest, { state, events: [] }),
  });
  return {
    manifest,
    journey,
    sceneId: "scene",
    watchedAssetIds: [],
    ownsSession: vi.fn(() => true),
    commit: vi.fn(),
    beforePurchase: vi.fn(),
    access: {
      checkAccess: vi.fn(async () => true),
      canAccess: vi.fn(() => true),
      requestAccess: vi.fn(async () => true),
      formatPrice: String,
    },
  };
}
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("journey replay transaction", () => {
  it("refreshes access before restoring the original entry without mutating the source", async () => {
    const input = fixture();
    const original = structuredClone(input.journey);
    expect(await new ExperienceJourneyReplay().replay(input)).toBe("restored");
    expect(input.access.checkAccess).toHaveBeenCalledOnce();
    expect(input.access.requestAccess).not.toHaveBeenCalled();
    expect(input.commit).toHaveBeenCalledOnce();
    const [entry, journey] = input.commit.mock.calls[0]!;
    expect(entry.state.deterministicRuntime.randomSeed).toBe("entry-seed");
    entry.state.watchedAssetIds.push("changed");
    expect(journey.visitedNodeIds).toEqual(["scene"]);
    expect(input.journey).toEqual(original);
  });
  it("allows free replay without an access service", async () => {
    const input = fixture(false);
    expect(await new ExperienceJourneyReplay().replay({ ...input, access: undefined })).toBe(
      "restored"
    );
    expect(input.commit).toHaveBeenCalledOnce();
  });
  it("refuses paid replay without an access service", async () => {
    const input = fixture();
    await expect(
      new ExperienceJourneyReplay().replay({ ...input, access: undefined })
    ).rejects.toThrow(/unlock required/);
    expect(input.commit).not.toHaveBeenCalled();
  });
  it("flushes the current story before purchase and commits only verified ownership", async () => {
    const input = fixture();
    const order: string[] = [];
    input.access.checkAccess.mockResolvedValue(false);
    input.beforePurchase.mockImplementation(() => {
      order.push("save");
    });
    input.access.requestAccess.mockImplementation(async () => {
      order.push("purchase");
      return true;
    });
    input.commit.mockImplementation(() => {
      order.push("commit");
    });
    await new ExperienceJourneyReplay().replay(input);
    expect(order).toEqual(["save", "purchase", "commit"]);
  });
  it("preserves the active story when purchase is cancelled", async () => {
    const input = fixture();
    input.access.checkAccess.mockResolvedValue(false);
    input.access.requestAccess.mockResolvedValue(false);
    expect(await new ExperienceJourneyReplay().replay(input)).toBe("cancelled");
    expect(input.commit).not.toHaveBeenCalled();
  });
  it("does not trust a successful purchase response without live ownership", async () => {
    const input = fixture();
    input.access.checkAccess.mockResolvedValue(false);
    input.access.canAccess.mockReturnValue(false);
    await expect(new ExperienceJourneyReplay().replay(input)).rejects.toThrow(/unlock required/);
    expect(input.commit).not.toHaveBeenCalled();
  });
  it("validates corrupt entries before requesting a purchase", async () => {
    const input = fixture();
    input.journey.anchors[0]!.state.currentSceneId = "missing";
    await expect(new ExperienceJourneyReplay().replay(input)).rejects.toThrow();
    expect(input.access.checkAccess).not.toHaveBeenCalled();
    expect(input.access.requestAccess).not.toHaveBeenCalled();
    expect(input.commit).not.toHaveBeenCalled();
  });
  it.each(["account", "generation", "abort"])(
    "rejects stale %s responses and releases the pending lock",
    async (reason) => {
      const input = fixture();
      const gate = deferred();
      input.access.checkAccess.mockReturnValueOnce(gate.promise);
      const signal = new AbortController();
      const replay = new ExperienceJourneyReplay();
      const pending = replay.replay({ ...input, signal: signal.signal });
      expect(await replay.replay(input)).toBe("busy");
      if (reason === "account") input.ownsSession.mockReturnValue(false);
      if (reason === "generation") replay.invalidate();
      if (reason === "abort") signal.abort();
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      gate.resolve(true);
      await assertion;
      expect(input.commit).not.toHaveBeenCalled();
      input.ownsSession.mockReturnValue(true);
      expect(await replay.replay(input)).toBe("restored");
    }
  );
  it("does not start a purchase after the pre-purchase save loses ownership", async () => {
    const input = fixture();
    input.access.checkAccess.mockResolvedValue(false);
    input.beforePurchase.mockImplementation(() => {
      input.ownsSession.mockReturnValue(false);
    });
    await expect(new ExperienceJourneyReplay().replay(input)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(input.access.requestAccess).not.toHaveBeenCalled();
    expect(input.commit).not.toHaveBeenCalled();
  });
  it("propagates upstream failures and allows an explicit retry", async () => {
    const input = fixture();
    input.access.checkAccess.mockRejectedValueOnce(new Error("Entitlement server unavailable"));
    const replay = new ExperienceJourneyReplay();
    await expect(replay.replay(input)).rejects.toThrow("Entitlement server unavailable");
    expect(input.commit).not.toHaveBeenCalled();
    expect(await replay.replay(input)).toBe("restored");
  });
  it("ignores a purchase approval that arrives after the player is replaced", async () => {
    const input = fixture();
    const gate = deferred();
    input.access.checkAccess.mockResolvedValue(false);
    input.access.requestAccess.mockReturnValue(gate.promise);
    const replay = new ExperienceJourneyReplay();
    const pending = replay.replay(input);
    await vi.waitFor(() => expect(input.access.requestAccess).toHaveBeenCalledOnce());
    replay.invalidate();
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    gate.resolve(true);
    await assertion;
    expect(input.commit).not.toHaveBeenCalled();
  });
  it("does not purchase when saving the outgoing story fails", async () => {
    const input = fixture();
    input.access.checkAccess.mockResolvedValue(false);
    input.beforePurchase.mockImplementation(() => {
      throw new Error("Save conflict");
    });
    await expect(new ExperienceJourneyReplay().replay(input)).rejects.toThrow("Save conflict");
    expect(input.access.requestAccess).not.toHaveBeenCalled();
    expect(input.commit).not.toHaveBeenCalled();
  });
});
