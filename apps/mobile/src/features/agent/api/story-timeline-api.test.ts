import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchTimelines,
  reflowTimeline,
  saveTimeline,
  timelineDraft,
  type TimelineSequence,
} from "./story-timeline-api";
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const sequence: TimelineSequence = {
  id: id(3),
  projectId: id(1),
  chapterId: id(2),
  plotNodeId: "clip:opening",
  title: "Scene",
  durationMs: 3000,
  version: 7,
  status: "current",
  clips: [
    {
      id: id(5),
      stableKey: "shot_a",
      title: "A",
      rank: 0,
      kind: "image",
      track: "visual",
      startMs: 0,
      durationMs: 1000,
      description: null,
      imagePrompt: "Frame A",
      videoPrompt: null,
      negativePrompt: null,
      status: "current",
      version: 2,
    },
    {
      id: id(6),
      stableKey: "shot_b",
      title: "B",
      rank: 1,
      kind: "video",
      track: "visual",
      startMs: 1000,
      durationMs: 2000,
      description: "Motion",
      imagePrompt: null,
      videoPrompt: "Frame B",
      negativePrompt: "Blur",
      status: "current",
      version: 4,
    },
  ],
};
const receipt = () => ({
  ...sequence,
  version: 8,
  clips: sequence.clips.map((clip) => ({ ...clip, version: clip.version + 1 })),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue([sequence]);
  h.put.mockResolvedValue(receipt());
});
it("loads scoped timelines and retains unedited server metadata", async () => {
  h.get.mockResolvedValue([{ ...sequence, cues: [{ id: id(7), atMs: 3000 }] }]);
  expect((await fetchTimelines(scope, new AbortController().signal))[0]?.cues).toEqual([
    { id: id(7), atMs: 3000 },
  ]);
});
it.each([
  { projectId: id(9) },
  { chapterId: id(9) },
  { clips: [sequence.clips[0], sequence.clips[0]] },
  { durationMs: 4000 },
  { clips: sequence.clips.map((clip) => ({ ...clip, startMs: 0 })) },
])("rejects malformed or cross-scope reads %j", async (patch) => {
  h.get.mockResolvedValue([{ ...sequence, ...patch }]);
  await expect(fetchTimelines(scope, new AbortController().signal)).rejects.toThrow();
});
it("preserves clip identities and CAS versions while reordering and resizing", () => {
  const draft = timelineDraft(sequence);
  const changed = reflowTimeline(draft.expectedVersion, [
    { ...draft.clips[1]!, durationMs: 1500 },
    draft.clips[0]!,
  ]);
  expect(changed.durationMs).toBe(2500);
  expect(changed.clips.map((clip) => [clip.id, clip.expectedVersion, clip.startMs])).toEqual([
    [id(6), 4, 0],
    [id(5), 2, 1500],
  ]);
  expect(sequence.clips[1]?.durationMs).toBe(2000);
});
it("supports canonical empty timelines and rejects too-short or oversized clips", () => {
  expect(reflowTimeline(7, [])).toEqual({ expectedVersion: 7, durationMs: 0, clips: [] });
  for (const durationMs of [249, 3600001, 1.5])
    expect(() =>
      reflowTimeline(7, [{ ...timelineDraft(sequence).clips[0]!, durationMs }])
    ).toThrow();
});
it("sends atomic replacement with caller-owned immutable idempotency key and no automatic retry", async () => {
  const input = timelineDraft(sequence);
  expect(await saveTimeline(scope, sequence.id, "timeline:request", input)).toEqual(receipt());
  expect(h.put).toHaveBeenCalledWith(
    `/story-projects/${id(1)}/chapters/${id(2)}/storyboard/sequences/${id(3)}/timeline`,
    {
      service: "aurora",
      retry: false,
      headers: { "Idempotency-Key": "timeline:request" },
      data: input,
    }
  );
});
it.each([
  { id: id(9) },
  { version: 7 },
  { clips: receipt().clips.map((clip) => ({ ...clip, title: "different" })) },
  { clips: receipt().clips.map((clip) => ({ ...clip, version: 0 })) },
  { clips: receipt().clips.map((clip, i) => ({ ...clip, id: id(10 + i) })) },
])("rejects unverified mutation receipts %j", async (patch) => {
  h.put.mockResolvedValue({ ...receipt(), ...patch });
  await expect(
    saveTimeline(scope, sequence.id, "timeline:request", timelineDraft(sequence))
  ).rejects.toThrow();
});
it("accepts server-generated identity and version zero for a newly appended clip", async () => {
  const draft = timelineDraft(sequence);
  const input = reflowTimeline(7, [
    ...draft.clips,
    {
      expectedVersion: 0,
      stableKey: "new_shot",
      title: "New",
      kind: "image",
      imagePrompt: "Frame",
      videoPrompt: null,
      negativePrompt: null,
      description: null,
      startMs: 0,
      durationMs: 1000,
    },
  ]);
  h.put.mockResolvedValue({
    ...receipt(),
    durationMs: 4000,
    clips: [
      ...receipt().clips,
      {
        ...sequence.clips[0],
        id: id(8),
        stableKey: "new_shot",
        title: "New",
        imagePrompt: "Frame",
        version: 0,
        rank: 2,
        startMs: 3000,
      },
    ],
  });
  await expect(saveTimeline(scope, sequence.id, "timeline:request", input)).resolves.toMatchObject({
    durationMs: 4000,
  });
});
it("retains caller request for explicit retry after a lost response", async () => {
  const input = timelineDraft(sequence);
  h.put.mockRejectedValueOnce(new Error("Network"));
  await expect(saveTimeline(scope, sequence.id, "timeline:request", input)).rejects.toThrow(
    "Network"
  );
  await saveTimeline(scope, sequence.id, "timeline:request", input);
  expect(h.put.mock.calls[0]).toEqual(h.put.mock.calls[1]);
});
it("blocks writes after account changes and rejects late receipts", async () => {
  h.generation = 2;
  await expect(
    saveTimeline(scope, sequence.id, "timeline:request", timelineDraft(sequence))
  ).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
  h.generation = 1;
  h.put.mockImplementation(async () => {
    h.generation = 2;
    return receipt();
  });
  await expect(
    saveTimeline(scope, sequence.id, "timeline:request", timelineDraft(sequence))
  ).rejects.toThrow();
});

it.each(["clip:one", "scene.opening", "city-gate"])(
  "accepts official stable plot IDs: %s",
  async (plotNodeId) => {
    h.get.mockResolvedValue([{ ...sequence, plotNodeId }]);
    expect((await fetchTimelines(scope, new AbortController().signal))[0].plotNodeId).toBe(
      plotNodeId
    );
  }
);
it.each(["", "../scene", "clip:one ", "scene..opening"])(
  "rejects invalid graph IDs: %s",
  async (plotNodeId) => {
    h.get.mockResolvedValue([{ ...sequence, plotNodeId }]);
    await expect(fetchTimelines(scope, new AbortController().signal)).rejects.toThrow();
  }
);

it("rejects ambiguous duplicate graph-node timelines", async () => {
  h.get.mockResolvedValue([sequence, { ...sequence, id: id(8) }]);
  await expect(fetchTimelines(scope, new AbortController().signal)).rejects.toThrow(
    "Duplicate timeline"
  );
});
