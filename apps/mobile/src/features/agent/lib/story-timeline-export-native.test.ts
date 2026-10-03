import { beforeEach, expect, it, vi } from "vitest";
import { createNativeTimelineEncoder } from "./story-timeline-export-native";
const h = vi.hoisted(() => ({
  module: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
  release: vi.fn(),
  listener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: h.module,
  uuid: { v4: () => "job" },
}));
const artifact = { uri: "file:///cache/export.mp4", contentType: "video/mp4", size: 10 };
const shots = [
  { id: "one", kind: "video" as const, url: "https://example.test/a.mp4", durationMs: 1000 },
];
beforeEach(() => {
  vi.resetAllMocks();
  h.module.mockReturnValue({
    render: h.render,
    cancel: h.cancel,
    release: h.release,
    addListener: h.listener,
  });
  h.listener.mockReturnValue({ remove: h.remove });
  h.cancel.mockResolvedValue(undefined);
  h.release.mockResolvedValue(undefined);
  h.render.mockResolvedValue({ artifact, completedClipIds: ["one"] });
});
it("preserves sources and filters progress to the owned export", async () => {
  const encoder = createNativeTimelineEncoder(),
    progress = vi.fn();
  h.render.mockImplementation(async () => {
    const listener = h.listener.mock.calls[0][1];
    listener({ id: "other", ratio: 0.5 });
    listener({ id: "job", ratio: 0.25 });
    return { artifact, completedClipIds: ["one"] };
  });
  await encoder.render(shots, new AbortController().signal, progress);
  expect(h.render).toHaveBeenCalledWith("job", shots);
  expect(progress.mock.calls).toEqual([[0.25]]);
  expect(h.remove).toHaveBeenCalledTimes(1);
  encoder.dispose();
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
});
it("fails explicitly if the app does not include the native module", async () => {
  h.module.mockReturnValue(null);
  const encoder = createNativeTimelineEncoder();
  expect(encoder.supported).toBe(false);
  await expect(encoder.render(shots, new AbortController().signal, vi.fn())).rejects.toThrow(
    "not included"
  );
});
it("cancels the exact job and releases any late native result", async () => {
  let resolve!: (v: unknown) => void;
  h.render.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const controller = new AbortController(),
    encoder = createNativeTimelineEncoder();
  const pending = encoder.render(shots, controller.signal, vi.fn());
  controller.abort();
  expect(h.cancel).toHaveBeenCalledWith("job");
  resolve({ artifact, completedClipIds: ["one"] });
  await expect(pending).rejects.toThrow();
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
  expect(h.remove).toHaveBeenCalledTimes(1);
});
it("rejects a receipt for different clips and frees its file", async () => {
  h.render.mockResolvedValue({ artifact, completedClipIds: ["other"] });
  await expect(
    createNativeTimelineEncoder().render(shots, new AbortController().signal, vi.fn())
  ).rejects.toThrow("receipt");
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
});
it("releases owned output once and refuses use after disposal", async () => {
  const encoder = createNativeTimelineEncoder();
  const result = await encoder.render(shots, new AbortController().signal, vi.fn());
  encoder.release(result.artifact);
  encoder.dispose();
  expect(h.release).toHaveBeenCalledTimes(1);
  await expect(encoder.render(shots, new AbortController().signal, vi.fn())).rejects.toThrow(
    "closed"
  );
});

it("accepts ordered partial output against the original snapshot", async () => {
  const input = [...shots, { ...shots[0]!, id: "two" }, { ...shots[0]!, id: "three" }];
  h.render.mockImplementation(async () => {
    input.reverse();
    return { artifact, completedClipIds: ["one", "three"] };
  });
  const result = await createNativeTimelineEncoder().render(
    input,
    new AbortController().signal,
    vi.fn()
  );
  expect(result.completedClipIds).toEqual(["one", "three"]);
});
it.each([{ ids: ["two", "one"] }, { ids: ["one", "one"] }, { ids: [] }])(
  "rejects invalid partial receipt $ids",
  async ({ ids }) => {
    h.render.mockResolvedValue({ artifact, completedClipIds: ids });
    await expect(
      createNativeTimelineEncoder().render(
        [...shots, { ...shots[0]!, id: "two" }],
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow();
    expect(h.release).toHaveBeenCalledWith(artifact.uri);
  }
);

const sourceError = () =>
  Object.assign(Error("Unreadable source"), { code: "EXPORT_SOURCE_FAILED" });
it("isolates source failures and composes remaining clips in original order", async () => {
  const input = [...shots, { ...shots[0]!, id: "bad" }, { ...shots[0]!, id: "three" }];
  h.render.mockImplementation(async (_id, clips) => {
    if (clips.some((s: { id: string }) => s.id === "bad")) throw sourceError();
    return {
      artifact: {
        ...artifact,
        uri: `file:///cache/${clips.map((s: { id: string }) => s.id).join("-")}.mp4`,
      },
      completedClipIds: clips.map((s: { id: string }) => s.id),
    };
  });
  const result = await createNativeTimelineEncoder().render(
    input,
    new AbortController().signal,
    vi.fn()
  );
  expect(result.completedClipIds).toEqual(["one", "three"]);
  expect(h.render.mock.calls.map((c) => c[1].map((s: { id: string }) => s.id))).toEqual([
    ["one", "bad", "three"],
    ["one"],
    ["bad"],
    ["three"],
    ["one", "three"],
  ]);
  expect(h.release.mock.calls).toEqual([["file:///cache/one.mp4"], ["file:///cache/three.mp4"]]);
});
it("does not isolate device-wide or unknown errors", async () => {
  h.render.mockRejectedValue(Error("Encoder unavailable"));
  await expect(
    createNativeTimelineEncoder().render(
      [...shots, { ...shots[0]!, id: "two" }],
      new AbortController().signal,
      vi.fn()
    )
  ).rejects.toThrow("Encoder unavailable");
  expect(h.render).toHaveBeenCalledOnce();
});
it("fails when every isolated source is unreadable", async () => {
  h.render.mockRejectedValue(sourceError());
  await expect(
    createNativeTimelineEncoder().render(
      [...shots, { ...shots[0]!, id: "two" }],
      new AbortController().signal,
      vi.fn()
    )
  ).rejects.toThrow("No timeline clips");
  expect(h.render).toHaveBeenCalledTimes(3);
});
it("stops recovery on cancellation instead of reporting a partial success", async () => {
  const controller = new AbortController();
  h.render.mockRejectedValueOnce(sourceError()).mockImplementationOnce(async () => {
    controller.abort();
    throw sourceError();
  });
  await expect(
    createNativeTimelineEncoder().render(
      [...shots, { ...shots[0]!, id: "two" }],
      controller.signal,
      vi.fn()
    )
  ).rejects.toThrow();
  expect(h.render).toHaveBeenCalledTimes(2);
});
it("stops isolation on a later encoder failure and frees earlier probe output", async () => {
  h.render
    .mockRejectedValueOnce(sourceError())
    .mockResolvedValueOnce({ artifact, completedClipIds: ["one"] })
    .mockRejectedValueOnce(Error("Disk full"));
  await expect(
    createNativeTimelineEncoder().render(
      [...shots, { ...shots[0]!, id: "two" }],
      new AbortController().signal,
      vi.fn()
    )
  ).rejects.toThrow("Disk full");
  expect(h.release).toHaveBeenCalledExactlyOnceWith(artifact.uri);
  expect(h.render).toHaveBeenCalledTimes(3);
});
it("forwards mixed media kinds and durations without reordering native work", async () => {
  const mixed = [
    {
      id: "still",
      kind: "image" as const,
      url: "https://example.test/still.png",
      durationMs: 3250,
    },
    ...shots,
  ];
  h.render.mockResolvedValue({ artifact, completedClipIds: ["still", "one"] });
  const result = await createNativeTimelineEncoder().render(
    mixed,
    new AbortController().signal,
    vi.fn()
  );
  expect(h.render).toHaveBeenCalledWith("job", mixed);
  expect(result.completedClipIds).toEqual(["still", "one"]);
});
