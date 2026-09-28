// @vitest-environment jsdom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComposerDraftStore } from "./use-composer-draft";
import { useReferenceUploads } from "./use-reference-uploads";
const mock = vi.hoisted(() => ({
  upload: vi.fn(),
  probe: vi.fn(),
  userId: "a",
  projectId: "one",
  workspaceId: "workspace",
  canEdit: true,
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => ({ id: mock.workspaceId }),
  useOptionalProjectContext: () => ({ projectId: mock.projectId, canEdit: mock.canEdit }),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: mock.userId } }),
}));
vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: mock.upload,
  isUploadAbort: (e: Error) => e.name === "AbortError",
}));
vi.mock("@/lib/canvas-authoring/probe-media-duration", () => ({
  probeMediaDurationSeconds: mock.probe,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let state: ReturnType<typeof useReferenceUploads>;
function Harness() {
  const value = useReferenceUploads();
  useLayoutEffect(() => {
    state = value;
  });
  return null;
}
beforeEach(() => {
  useComposerDraftStore.setState({ drafts: {} });
  mock.userId = "a";
  mock.projectId = "one";
  mock.workspaceId = "workspace";
  mock.canEdit = true;
  root = createRoot(document.createElement("div"));
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() })
  );
  mock.upload.mockImplementation(() => new Promise(() => {}));
  mock.probe.mockResolvedValue(null);
  act(() =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const file = new File(["x"], "x.mp4", { type: "video/mp4" });
it("allocates each preview once in StrictMode and releases same-tick additions on clear", () => {
  act(() => {
    state.addFiles("refs", "image", [file, file]);
  });
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  act(() => state.clear());
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(state.items).toEqual([]);
});
it("keeps mention labels unique after removing a middle reference", () => {
  act(() => state.addFiles("refs", "image", [file, file]));
  act(() => state.remove(state.items[0]!.id));
  act(() => state.addFiles("refs", "image", [file]));
  expect(state.items.map((x) => x.label)).toEqual(["Image2", "Image3"]);
});
it("shares cancellation with probing and stops the probe after upload failure", async () => {
  mock.upload.mockRejectedValueOnce(new Error("Quota exhausted"));
  await act(async () => state.addFiles("refs", "video", [file]));
  const signal = mock.probe.mock.calls[0][2] as AbortSignal;
  expect(signal.aborted).toBe(true);
  expect(state.items[0]?.error).toBe("Quota exhausted");
  expect(state.items[0]?.uploading).toBe(false);
});
it("suppresses a successful result arriving after removal", async () => {
  let resolve!: (x: unknown) => void;
  mock.upload.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  act(() => state.addFiles("refs", "video", [file]));
  const signal = mock.probe.mock.calls[0][2] as AbortSignal;
  act(() => state.remove(state.items[0]!.id));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ url: "old", mediaAssetId: "old" }));
  expect(state.items).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("stops metadata probing when the upload transport aborts itself", async () => {
  mock.upload.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
  await act(async () => state.addFiles("refs", "video", [file]));
  expect(mock.probe.mock.calls[0][2].aborted).toBe(true);
  expect(state.items).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it.each(["userId", "projectId", "workspaceId"] as const)(
  "clears drafts and cancels old uploads after %s changes",
  async (key) => {
    let finish!: (value: unknown) => void;
    mock.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    act(() => state.addFiles("refs", "video", [file]));
    const oldAdd = state.addFiles;
    const signal = mock.probe.mock.calls[0][2] as AbortSignal;
    mock[key] = "replacement";
    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      )
    );
    expect(state.items).toEqual([]);
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    act(() => oldAdd("refs", "video", [file]));
    expect(mock.upload).toHaveBeenCalledTimes(1);
    await act(async () => finish({ url: "old", mediaAssetId: "old" }));
    expect(state.items).toEqual([]);
    act(() => state.addFiles("refs", "image", [file]));
    expect(state.items[0]?.label).toBe("Image1");
  }
);
it("abandons references when edit authority is lost and rejects new starts", () => {
  act(() => state.addFiles("refs", "video", [file]));
  mock.canEdit = false;
  act(() =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>
    )
  );
  expect(state.items).toEqual([]);
  act(() => state.addFiles("refs", "image", [file]));
  expect(mock.upload).toHaveBeenCalledTimes(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps durations with their files when transfers and probes finish in different orders", async () => {
  const firstUpload = deferred<{ url: string; mediaAssetId: string }>();
  const secondUpload = deferred<{ url: string; mediaAssetId: string }>();
  const firstProbe = deferred<number | null>();
  const secondProbe = deferred<number | null>();
  mock.upload.mockReturnValueOnce(firstUpload.promise).mockReturnValueOnce(secondUpload.promise);
  mock.probe.mockReturnValueOnce(firstProbe.promise).mockReturnValueOnce(secondProbe.promise);
  const other = new File(["second"], "second.mp4", { type: "video/mp4" });
  act(() => state.addFiles("refs", "video", [file, other]));
  await act(async () => {
    firstUpload.resolve({ url: "first.mp4", mediaAssetId: "first" });
    secondProbe.resolve(2.75);
  });
  expect(state.items.every((item) => item.uploading)).toBe(true);
  await act(async () => secondUpload.resolve({ url: "second.mp4", mediaAssetId: "second" }));
  expect(state.items[0]?.uploading).toBe(true);
  expect(state.items[1]).toMatchObject({
    name: "second.mp4",
    url: "second.mp4",
    mediaAssetId: "second",
    durationSeconds: 2.75,
    bytes: other.size,
    uploading: false,
  });
  await act(async () => firstProbe.resolve(1.25));
  expect(state.items[0]).toMatchObject({
    name: "x.mp4",
    url: "first.mp4",
    mediaAssetId: "first",
    durationSeconds: 1.25,
    bytes: file.size,
    uploading: false,
  });
  expect(state.items[1]?.durationSeconds).toBe(2.75);
});

it("does not restore a removed upload when its delayed duration probe resolves", async () => {
  const probe = deferred<number | null>();
  mock.upload.mockResolvedValueOnce({ url: "removed.mp4", mediaAssetId: "removed" });
  mock.probe.mockReturnValueOnce(probe.promise);
  await act(async () => state.addFiles("refs", "video", [file]));
  const removed = state.items[0]!;
  act(() => state.remove(removed.id));
  mock.upload.mockResolvedValueOnce({ url: "current.mp4", mediaAssetId: "current" });
  mock.probe.mockResolvedValueOnce(8.5);
  await act(async () => state.addFiles("refs", "video", [file]));
  await act(async () => probe.resolve(99));
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({
    url: "current.mp4",
    durationSeconds: 8.5,
    uploading: false,
  });
  expect(state.items[0]?.id).not.toBe(removed.id);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(removed.previewUrl);
});

function SharedHarness() {
  const value = useReferenceUploads("image");
  useLayoutEffect(() => {
    state = value;
  });
  return null;
}
it("retains completed references across Home/tool remounts with durable previews and unique labels", async () => {
  await act(async () => root.render(<SharedHarness />));
  mock.upload.mockResolvedValueOnce({ url: "/uploaded/image.png", mediaAssetId: "image" });
  await act(async () => state.addFiles("refs", "image", [file]));
  const first = state.items[0]!;
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(first.previewUrl);
  await act(async () => root.render(<SharedHarness />));
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({
    url: "/uploaded/image.png",
    previewUrl: "/uploaded/image.png",
    label: "Image1",
  });
  act(() => state.addFiles("refs", "image", [file]));
  expect(state.items.map((item) => item.label)).toEqual(["Image1", "Image2"]);
  await act(async () => root.render(null));
  await act(async () => root.render(<SharedHarness />));
  expect(state.items).toHaveLength(1); // In-flight uploads are cancelled, never restored as stuck tiles.
});
it("does not carry shared references into another workspace", async () => {
  await act(async () => root.render(<SharedHarness />));
  mock.upload.mockResolvedValueOnce({ url: "/uploaded/private.png", mediaAssetId: "private" });
  await act(async () => state.addFiles("refs", "image", [file]));
  mock.workspaceId = "other-workspace";
  await act(async () => root.render(<SharedHarness />));
  expect(state.items).toEqual([]);
});
