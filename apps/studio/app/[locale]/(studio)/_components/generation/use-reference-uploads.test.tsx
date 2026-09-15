// @vitest-environment jsdom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
