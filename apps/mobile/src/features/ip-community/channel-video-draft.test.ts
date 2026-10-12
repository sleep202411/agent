import { beforeEach, expect, it, vi } from "vitest";
import { channelVideoDraftStorage, type ChannelVideoDraft } from "./channel-video-draft";
const h = vi.hoisted(() => ({ records: new Map<string, string>(), region: "global", fail: false }));
vi.mock("@/lib/durable-record-key", () => ({
  durableRecordKey: (...args: string[]) => JSON.stringify([h.region, ...args]),
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (...args: string[]) => {
    const key = JSON.stringify([h.region, ...args]);
    return {
      read: () => h.records.get(key) ?? null,
      write: (value: string) => {
        if (h.fail) throw new Error("Disk full");
        h.records.set(key, value);
      },
    };
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
const id = "11111111-1111-4111-8111-111111111111";
const pending: ChannelVideoDraft = {
  stage: "submit",
  input: { assetId: id, title: "Original title", description: "Original text" },
};
beforeEach(() => {
  h.records.clear();
  h.region = "global";
  h.fail = false;
});
it("restores the exact submission after restart and clears only after acknowledgement", () => {
  channelVideoDraftStorage("owner", id).save(pending);
  const restored = channelVideoDraftStorage("owner", id);
  expect(restored.read()).toEqual(pending);
  restored.clear();
  expect(restored.read()).toBeNull();
});
it("keeps upload confirmation before an asset ID is available", () => {
  const value: ChannelVideoDraft = {
    stage: "confirm",
    metadata: { title: pending.input.title, description: pending.input.description },
    confirmation: { storageKey: "upload/key", kind: "episode_video", contentType: "video/webm" },
  };
  const storage = channelVideoDraftStorage("owner", id);
  storage.save(value);
  expect(storage.read()).toEqual({
    ...value,
    metadata: { title: "Original title", description: "Original text" },
  });
});
it("isolates account, channel and region", () => {
  channelVideoDraftStorage("owner", id).save(pending);
  expect(channelVideoDraftStorage("other", id).read()).toBeNull();
  expect(
    channelVideoDraftStorage("owner", "22222222-2222-4222-8222-222222222222").read()
  ).toBeNull();
  h.region = "cn";
  expect(channelVideoDraftStorage("owner", id).read()).toBeNull();
});
it("does not silently discard corrupt recovery records", () => {
  channelVideoDraftStorage("owner", id).save(pending);
  for (const key of h.records.keys()) h.records.set(key, "broken");
  expect(() => channelVideoDraftStorage("owner", id).read()).toThrow();
});
it("surfaces persistence failure so callers do not proceed with submission", () => {
  h.fail = true;
  expect(() => channelVideoDraftStorage("owner", id).save(pending)).toThrow("Disk full");
});
it("rejects workspace-scoped recovery and unsupported file types", () => {
  const storage = channelVideoDraftStorage("owner", id);
  expect(() =>
    storage.save({
      stage: "confirm",
      metadata: { title: "Film", description: "" },
      confirmation: {
        storageKey: "key",
        kind: "episode_video",
        contentType: "video/mp4",
        scope: { storyProjectId: id },
      },
    } as ChannelVideoDraft)
  ).toThrow();
});
