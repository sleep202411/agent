import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import type { ExperienceJourney } from "@repo/shared/experience-runtime";
import {
  fetchLatestSave,
  getStorySaveChannel,
  reloadStorySaveGame,
  type SavePayload,
  type StorySave,
} from "./story-save-channel";

const h = vi.hoisted(() => ({ generation: 0, get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: h,
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
const payload: SavePayload = {
  contentVersion: "release",
  state: { scene: "first" },
  events: [],
  playback: { positionMs: 1000 },
};
const saved: StorySave = {
  gameId: "game",
  chapterId: "chapter",
  ...payload,
  revision: 3,
  updatedAt: "2026-10-04T12:00:00Z",
};
const journey = (nodes = ["first"]): ExperienceJourney => ({
  version: 1,
  signature: "journey-v1:fixture",
  visitedNodeIds: nodes,
  traversedEdges: [],
  traversedPaths: [],
  watchedMedia: [],
  activeAccessRefs: [],
  anchors: nodes.map((sceneId) => ({
    sceneId,
    state: { currentSceneId: sceneId },
    events: [],
    requiredAccessRefs: [],
  })),
});
function writer(chapterId = "chapter") {
  return getStorySaveChannel("account", "game", chapterId);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  h.generation++;
  h.get.mockReset().mockResolvedValue({ save: saved, revision: 3 });
  h.put.mockReset().mockImplementation(async (_path, config) => ({
    saved: true,
    updatedAt: "2026-10-05T00:00:00Z",
    revision: config.data.expectedRevision + 1,
  }));
  h.delete.mockReset().mockImplementation(async (_path, config) => ({
    cleared: true,
    revision: config.params.expectedRevision + 1,
  }));
});
describe("account session chapter save coordinator", () => {
  it("rejects a delayed latest pointer when the account changes", async () => {
    const pending = deferred<StorySave>();
    h.get.mockReturnValueOnce(pending.promise);
    const latest = fetchLatestSave("account", "game");
    await tick();
    h.generation++;
    pending.resolve(saved);
    await expect(latest).rejects.toHaveProperty("name", "AbortError");
  });
  it("keeps an uncertain write pending and stops on the server's changed revision", async () => {
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    h.put.mockRejectedValueOnce(new Error("Response lost"));
    await expect(channel.flush()).rejects.toThrow("Response lost");
    expect(channel.getPending()).toEqual(payload);
    h.put.mockRejectedValueOnce(new ApiRequestError("SAVE_CONFLICT", "Save changed", 409));
    await expect(channel.flush()).rejects.toThrow("Save changed");
    await channel.flush();
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.put.mock.calls.every((call) => call[1].data.expectedRevision === 3)).toBe(true);
    expect(channel.getStatus().phase).toBe("conflict");
    h.get.mockResolvedValue({ save: { ...saved, revision: 4 }, revision: 4 });
    await channel.reload();
    expect(channel.getPending()).toBeNull();
    expect(channel.getRevision()).toBe(4);
  });
  it("synchronizes a large offline history in bounded chunks and retries only unacknowledged entries", async () => {
    const full = journey(Array.from({ length: 130 }, (_, index) => `scene.${index}`));
    const channel = writer();
    await channel.read();
    channel.replace({ ...payload, journey: full });
    const originalPut = h.put.getMockImplementation()!;
    h.put.mockImplementationOnce(originalPut).mockRejectedValueOnce(new Error("Offline again"));
    await expect(channel.flush()).rejects.toThrow("Offline again");
    const first = h.put.mock.calls[0]![1].data.journeyDelta;
    expect(first.anchors).toHaveLength(64);
    expect(channel.getPending()?.journey).toEqual(full);
    expect(channel.getRevision()).toBe(4);
    await channel.flush();
    const successfulChunks = [
      first,
      ...h.put.mock.calls.slice(2).map((call) => call[1].data.journeyDelta),
    ];
    expect(successfulChunks.every((chunk) => chunk.anchors.length <= 64)).toBe(true);
    expect(
      successfulChunks.flatMap((chunk) =>
        chunk.anchors.map((anchor: { sceneId: string }) => anchor.sceneId)
      )
    ).toEqual(full.anchors.map((anchor) => anchor.sceneId));
    expect(channel.getStatus().phase).toBe("saved");
    expect(channel.getPending()).toBeNull();
    channel.replace({ ...payload, journey: full });
    await channel.flush();
    expect(h.put.mock.calls.at(-1)![1].data.journeyDelta).toBeUndefined();
  });
  it("sends only changed exploration and omits it on ordinary progress writes", async () => {
    const first = journey();
    h.get.mockResolvedValue({ save: { ...saved, journey: first }, revision: 3 });
    const channel = writer();
    await channel.read();
    channel.replace({ ...payload, journey: journey(["first", "second"]) });
    await channel.flush();
    const change = h.put.mock.calls[0]![1].data;
    expect(change.journey).toBeUndefined();
    expect(change.journeyDelta.addedVisitedNodeIds).toEqual(["second"]);
    expect(
      change.journeyDelta.anchors.map((anchor: { sceneId: string }) => anchor.sceneId)
    ).toEqual(["second"]);
    channel.replace({ ...payload, journey: journey(["first", "second"]) });
    await channel.flush();
    expect(h.put.mock.calls[1]![1].data.journeyDelta).toBeUndefined();
  });
  it("computes a queued delta against the acknowledged journey and retains newer anchors", async () => {
    const first = deferred<{ saved: true; updatedAt: string; revision: number }>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    await channel.read();
    channel.replace({ ...payload, journey: journey() });
    const sending = channel.flush();
    await tick();
    channel.replace({ ...payload, journey: journey(["first", "second"]) });
    const second = channel.flush();
    first.resolve({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 4 });
    await sending;
    await second;
    expect(h.put.mock.calls[1]![1].data.journeyDelta.addedVisitedNodeIds).toEqual(["second"]);
    expect(h.put.mock.calls[1]![1].data.expectedRevision).toBe(4);
  });
  it("resends unsaved anchors after a failed update instead of advancing the journey baseline", async () => {
    const channel = writer();
    await channel.read();
    h.put.mockRejectedValueOnce(new Error("Storage unavailable"));
    channel.replace({ ...payload, journey: journey() });
    await expect(channel.flush()).rejects.toThrow("Storage unavailable");
    await channel.flush();
    expect(h.put.mock.calls[1]![1].data.journeyDelta.anchors).toHaveLength(1);
  });
  it("clears the acknowledged journey with the run and sends fresh anchors after restart", async () => {
    const initial = journey();
    h.get.mockResolvedValue({ save: { ...saved, journey: initial }, revision: 3 });
    const channel = writer();
    await channel.read();
    await channel.clear();
    channel.replace({ ...payload, journey: initial });
    await channel.flush();
    expect(h.put.mock.calls[0]![1].data.journeyDelta.anchors).toHaveLength(1);
  });
  it("round-trips playback and writes against a null slot's tombstone revision", async () => {
    h.get.mockResolvedValue({ save: null, revision: 9 });
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    await channel.flush();
    expect(h.put).toHaveBeenCalledWith(
      "/story-saves/game/save",
      expect.objectContaining({
        data: { ...payload, expectedRevision: 9 },
        params: { chapterId: "chapter" },
      })
    );
    expect(channel.getStatus()).toEqual({ phase: "saved", error: null });
  });
  it("serializes writes and keeps newer progress pending after an older acknowledgement", async () => {
    const first = deferred<{ saved: true; updatedAt: string; revision: number }>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    const flush = channel.flush();
    await tick();
    const newest = { ...payload, playback: { positionMs: 2000 } };
    channel.replace(newest);
    const forced = channel.flush();
    expect(h.put).toHaveBeenCalledOnce();
    first.resolve({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 4 });
    await flush;
    expect(channel.getStatus().phase).not.toBe("saved");
    await forced;
    expect(h.put.mock.calls[1]?.[1]?.data).toEqual({ ...newest, expectedRevision: 4 });
    expect(channel.getPending()).toBeNull();
    expect(channel.getStatus().phase).toBe("saved");
  });
  it("retains the newest checkpoint after an older PUT fails and exposes the raw retry error", async () => {
    const first = deferred<never>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    const failed = channel.flush();
    await tick();
    const newest = { ...payload, playback: { positionMs: 3500 } };
    channel.replace(newest);
    first.reject(new Error("Storage service HTTP 503"));
    await expect(failed).rejects.toThrow("Storage service HTTP 503");
    expect(channel.getPending()).toEqual(newest);
    expect(channel.getStatus()).toEqual({ phase: "error", error: "Storage service HTTP 503" });
    await channel.flush();
    expect(h.put.mock.calls[1]?.[1]?.data).toEqual({ ...newest, expectedRevision: 3 });
  });
  it("never retries a conflict or clears changed progress until explicit reload", async () => {
    h.put.mockRejectedValueOnce(new ApiRequestError("SAVE_CONFLICT", "Remote save changed", 409));
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    await expect(channel.flush()).rejects.toThrow("Remote save changed");
    channel.replace({ ...payload, state: { scene: "later" } });
    await channel.flush();
    await expect(channel.clear()).rejects.toThrow("Remote save changed");
    expect(h.put).toHaveBeenCalledOnce();
    expect(h.delete).not.toHaveBeenCalled();
    h.get.mockResolvedValue({ save: { ...saved, revision: 6 }, revision: 6 });
    await channel.reload();
    expect(channel.getPending()).toBeNull();
    channel.replace(payload);
    await channel.flush();
    expect(h.put.mock.calls[1]?.[1]?.data.expectedRevision).toBe(6);
  });
  it("preserves unsaved progress when a conflict reload fails", async () => {
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    h.get.mockRejectedValueOnce(new Error("Read unavailable"));
    await expect(channel.reload()).rejects.toThrow("Read unavailable");
    expect(channel.getPending()).toEqual(payload);
  });
  it("reads and latest pointers wait for the previous view's in-flight write", async () => {
    const first = deferred<{ saved: true; updatedAt: string; revision: number }>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    const flush = channel.flush();
    await tick();
    h.get.mockClear();
    const read = channel.read();
    const latest = fetchLatestSave("account", "game");
    await tick();
    expect(h.get).not.toHaveBeenCalled();
    h.get.mockImplementation(async (path) =>
      path.endsWith("/latest")
        ? { ...saved, revision: 4 }
        : { save: { ...saved, revision: 4 }, revision: 4 }
    );
    first.resolve({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 4 });
    await Promise.all([flush, read, latest]);
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it("reuses a writer across Mobile remounts and never sends queued operations under a replacement account session", async () => {
    const first = deferred<{ saved: true; updatedAt: string; revision: number }>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    expect(writer()).toBe(channel);
    await channel.read();
    channel.replace(payload);
    const flush = channel.flush();
    await tick();
    channel.replace({ ...payload, playback: { positionMs: 4000 } });
    const queued = channel.flush();
    h.generation++;
    getStorySaveChannel("other-account", "game", "chapter");
    expect(h.put.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    first.resolve({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 4 });
    await expect(flush).rejects.toHaveProperty("name", "AbortError");
    await expect(queued).rejects.toHaveProperty("name", "AbortError");
    expect(h.put).toHaveBeenCalledOnce();
  });
  it("does not publish the previous account's delayed acknowledgement", async () => {
    const first = deferred<{ saved: true; updatedAt: string; revision: number }>();
    h.put.mockReturnValueOnce(first.promise);
    const channel = writer();
    const listener = vi.fn();
    channel.subscribe(listener);
    await channel.read();
    channel.replace(payload);
    const flush = channel.flush();
    await tick();
    listener.mockClear();
    h.generation++;
    first.resolve({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 4 });
    await expect(flush).rejects.toHaveProperty("name", "AbortError");
    expect(listener).not.toHaveBeenCalled();
  });
  it("conditionally clears after pending writes and keeps the resulting revision for a fresh run", async () => {
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    await channel.flush();
    await channel.clear();
    channel.replace(payload);
    await channel.flush();
    expect(h.delete.mock.calls[0]?.[1]?.params).toEqual({
      chapterId: "chapter",
      expectedRevision: 4,
    });
    expect(h.put.mock.calls[1]?.[1]?.data.expectedRevision).toBe(5);
  });
  it("detects a cross-device revision change before resuming unsaved local progress", async () => {
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    h.get.mockResolvedValue({ save: { ...saved, revision: 8 }, revision: 8 });
    await expect(channel.read()).rejects.toHaveProperty("status", 409);
    await channel.flush();
    expect(h.put).not.toHaveBeenCalled();
  });
  it("reloads each affected chapter only on explicit game recovery", async () => {
    const first = writer();
    const second = writer("other");
    first.adopt(saved);
    second.adopt({ ...saved, chapterId: "other" });
    first.replace(payload);
    second.replace(payload);
    h.get.mockImplementation(async (_path, config) => ({
      save: {
        ...saved,
        chapterId: config.params.chapterId === "other" ? "other" : "chapter",
        revision: 5,
      },
      revision: 5,
    }));
    await reloadStorySaveGame("account", "game");
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(first.getPending()).toBeNull();
    expect(second.getPending()).toBeNull();
  });
  it("rejects mismatched slot and acknowledgement revisions", async () => {
    h.get.mockResolvedValueOnce({ save: { ...saved, chapterId: "wrong" }, revision: 3 });
    const channel = writer();
    await expect(channel.read()).rejects.toThrow("Save belongs to another");
    await channel.read();
    channel.replace(payload);
    h.put.mockResolvedValueOnce({ saved: true, updatedAt: "2026-10-05T00:00:00Z", revision: 99 });
    await expect(channel.flush()).rejects.toThrow("Invalid save acknowledgement");
    expect(channel.getStatus().phase).toBe("error");
    expect(channel.getPending()).toEqual(payload);
  });
  it("preserves unconfirmed progress after a failed clear without replacing newer pending progress", async () => {
    const channel = writer();
    await channel.read();
    channel.replace(payload);
    const first = deferred<never>();
    h.delete.mockReturnValueOnce(first.promise);
    const clear = channel.clear();
    await tick();
    first.reject(new Error("Delete HTTP 503"));
    await expect(clear).rejects.toThrow("Delete HTTP 503");
    expect(channel.getPending()).toEqual(payload);
    const second = deferred<never>();
    h.delete.mockReturnValueOnce(second.promise);
    const next = channel.clear();
    await tick();
    const newest = { ...payload, playback: { positionMs: 9000 } };
    channel.replace(newest);
    second.reject(new Error("Delete unavailable"));
    await expect(next).rejects.toThrow("Delete unavailable");
    expect(channel.getPending()).toEqual(newest);
  });
  it("never exposes an unresolved revision or accepts a revision older than an acknowledged write", async () => {
    const channel = writer();
    expect(() => channel.getRevision()).toThrow("has not been read");
    await channel.read();
    expect(channel.getRevision()).toBe(3);
    channel.replace(payload);
    await channel.flush();
    expect(channel.getRevision()).toBe(4);
    await expect(channel.read()).rejects.toThrow("moved backwards");
  });
});
