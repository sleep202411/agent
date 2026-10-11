import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchTimelineCandidates,
  replaceTimelineMedia,
  timelineMediaPending,
  type TimelineMediaCommand,
} from "./story-timeline-media";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), patch: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, patch: h.patch } }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const command: TimelineMediaCommand = {
  clientKey: id(3),
  sequenceId: id(4),
  clipId: id(5),
  input: {
    expectedVersion: 2,
    sourceMediaAssetId: id(6),
    kind: "image",
    imagePrompt: "Frame",
    videoPrompt: null,
  },
};
const clip = {
  id: id(5),
  stableKey: "clip",
  title: "Clip",
  rank: 0,
  kind: "image",
  track: "visual",
  startMs: 0,
  durationMs: 1000,
  description: null,
  imagePrompt: "Frame",
  videoPrompt: null,
  negativePrompt: null,
  status: "current",
  version: 3,
  selectedMediaVersion: { mediaAssetId: id(6), mediaKind: "image" },
};
const candidate = {
  asset: {
    id: id(6),
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/png",
    previewUrl: "https://example.com/image.png",
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue([candidate]);
  h.patch.mockResolvedValue(clip);
});
it("lists only usable project image/video candidates", async () => {
  h.get.mockResolvedValue([
    candidate,
    { asset: { ...candidate.asset, id: id(7), kind: "audio" } },
    { asset: { ...candidate.asset, id: id(8), status: "uploading" } },
    { asset: { ...candidate.asset, id: id(9), moderationStatus: "blocked" } },
  ]);
  expect(await fetchTimelineCandidates(scope, new AbortController().signal)).toEqual([candidate]);
});
it("rejects duplicate candidates and late account responses", async () => {
  h.get.mockResolvedValue([candidate, candidate]);
  await expect(fetchTimelineCandidates(scope, new AbortController().signal)).rejects.toThrow();
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return [candidate];
  });
  await expect(fetchTimelineCandidates(scope, new AbortController().signal)).rejects.toThrow();
});
it("patches the exact clip with version and stable idempotency key", async () => {
  await expect(replaceTimelineMedia(scope, command)).resolves.toMatchObject({
    selectedMediaVersion: { mediaAssetId: id(6) },
  });
  expect(h.patch).toHaveBeenCalledWith(
    `/story-projects/${id(1)}/chapters/${id(2)}/storyboard/sequences/${id(4)}/clips/${id(5)}`,
    {
      service: "aurora",
      retry: false,
      headers: { "Idempotency-Key": `timeline-media:${id(3)}` },
      data: command.input,
    }
  );
});
it.each([
  { id: id(7) },
  { version: 2 },
  { imagePrompt: "Changed" },
  { selectedMediaVersion: null },
  { selectedMediaVersion: { mediaAssetId: id(8), mediaKind: "image" } },
  { selectedMediaVersion: { mediaAssetId: id(6), mediaKind: "video" } },
])("rejects mismatched replacement receipts %j", async (patch) => {
  h.patch.mockResolvedValue({ ...clip, ...patch });
  await expect(replaceTimelineMedia(scope, command)).rejects.toThrow();
});
it("persists before dispatch and recovers the exact request after a lost response", async () => {
  let raw: string | null = null;
  const storage = {
    read: () => raw,
    write: (value: string) => {
      raw = value;
    },
  };
  const store = timelineMediaPending(scope, "user", storage);
  h.patch.mockImplementationOnce(async () => {
    expect(raw).toContain(command.clientKey);
    throw Error("Network");
  });
  await expect(store.submit(command)).rejects.toThrow("Network");
  const reopened = timelineMediaPending(scope, "user", storage);
  expect(reopened.read()).toEqual(command);
  await reopened.submit(reopened.read()!);
  expect(reopened.read()).toBeNull();
  expect(h.patch.mock.calls[0]).toEqual(h.patch.mock.calls[1]);
});
it("blocks dispatch if storage fails or the session changes", async () => {
  const store = timelineMediaPending(scope, "user", {
    read: () => null,
    write: () => {
      throw Error("Full");
    },
  });
  await expect(store.submit(command)).rejects.toThrow("Full");
  expect(h.patch).not.toHaveBeenCalled();
  h.generation = 2;
  await expect(replaceTimelineMedia(scope, command)).rejects.toThrow();
  expect(h.patch).not.toHaveBeenCalled();
});
