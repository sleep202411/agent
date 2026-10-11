import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskDeliveryUpload } from "./task-delivery-upload";
const state = vi.hoisted(() => ({
  upload: vi.fn(),
  attach: vi.fn(),
  resolve: vi.fn(),
  allowed: true,
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { put: state.resolve } }));
vi.mock("@/src/lib/media-upload", () => ({ uploadFileViaSignedUrl: state.upload }));
vi.mock("../../_hooks/use-crew-assets", () => ({
  attachCrewAssetFile: state.attach,
  useCrewAssetContext: () => ({
    data: { storageAvailable: true, capabilities: { upload: state.allowed } },
  }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
const onUploaded = vi.fn(),
  onBusy = vi.fn();
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  state.allowed = true;
  state.upload.mockReset();
  state.attach.mockReset();
  state.resolve.mockReset();
  onUploaded.mockClear();
  onBusy.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});
function render(scope = "task-a", parentId: string | null = "folder-a") {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <TaskDeliveryUpload
          key={scope}
          crewId="crew"
          taskId={scope}
          parentId={parentId}
          label="Film"
          disabled={false}
          onUploaded={onUploaded}
          onBusyChange={onBusy}
        />
      </QueryClientProvider>
    )
  );
}
async function choose(file = new File(["film"], "film.mp4", { type: "video/mp4" })) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function retry() {
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "retry")!.click()
  );
}
async function clearFailedUpload() {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "clearFailedUpload")!
      .click()
  );
}
it("allows replacing a permanently rejected file without reopening the task", async () => {
  state.upload.mockRejectedValueOnce(new Error("MEDIA_FILE_TOO_LARGE"));
  render();
  await choose();
  expect(host.querySelector("input")!.disabled).toBe(true);
  await clearFailedUpload();
  expect(host.querySelector("input")!.disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  const replacement = new File(["smaller"], "smaller.mp4", { type: "video/mp4" });
  state.upload.mockResolvedValue({ mediaAssetId: "replacement-media" });
  state.attach.mockResolvedValue({ id: "replacement-node", name: replacement.name });
  await choose(replacement);
  expect(state.upload.mock.calls[1][0]).toBe(replacement);
  expect(onUploaded).toHaveBeenCalledWith({ id: "replacement-node", name: replacement.name });
});
it("discards the old checkpoint and media receipt when explicitly clearing a failed attachment", async () => {
  state.upload.mockImplementationOnce(async (_file, options) => {
    options.onCheckpoint({ storageKey: "old-key" });
    return { mediaAssetId: "old-media" };
  });
  state.attach.mockRejectedValueOnce(new Error("Attachment rejected"));
  render();
  await choose();
  await clearFailedUpload();
  state.upload.mockResolvedValue({ mediaAssetId: "new-media" });
  state.attach.mockResolvedValue({ id: "new-node", name: "new.mp4" });
  await choose(new File(["new"], "new.mp4", { type: "video/mp4" }));
  expect(state.upload).toHaveBeenCalledTimes(2);
  expect(state.upload.mock.calls[1][1].resumeFrom).toBeUndefined();
  expect(state.attach.mock.calls[1][1].mediaAssetId).toBe("new-media");
});
it("binds only a completed attachment and reports its busy lifecycle", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "media" });
  state.attach.mockResolvedValue({ id: "node", name: "Film" });
  render();
  await choose();
  expect(state.attach).toHaveBeenCalledWith(
    "crew",
    { mediaAssetId: "media", name: "film.mp4", parentId: "folder-a" },
    expect.any(AbortSignal)
  );
  expect(onUploaded).toHaveBeenCalledWith({ id: "node", name: "Film" });
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});
it("retries an ambiguous attachment with the same media and original folder without re-uploading", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "media" });
  state.attach
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue({ id: "node", name: "Film" });
  render();
  await choose();
  expect(onUploaded).not.toHaveBeenCalled();
  render("task-a", "folder-b");
  await retry();
  expect(state.upload).toHaveBeenCalledTimes(1);
  expect(state.attach.mock.calls[1][1]).toEqual(state.attach.mock.calls[0][1]);
  expect(onUploaded).toHaveBeenCalledTimes(1);
});
it("resumes confirmation from its checkpoint instead of putting the file twice", async () => {
  const checkpoint = { storageKey: "signed-key" };
  state.upload
    .mockImplementationOnce(async (_file, options) => {
      options.onCheckpoint(checkpoint);
      throw new Error("Confirm unavailable");
    })
    .mockResolvedValue({ mediaAssetId: "media" });
  state.attach.mockResolvedValue({ id: "node", name: "Film" });
  render();
  await choose();
  await retry();
  expect(state.upload.mock.calls[1][1].resumeFrom).toBe(checkpoint);
});
it("aborts on task/account/template change and ignores late attachment responses", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "media" });
  let finish!: (node: unknown) => void;
  state.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render();
  await choose();
  const signal = state.attach.mock.calls[0][2] as AbortSignal;
  render("task-b");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ id: "old", name: "Old" }));
  expect(onUploaded).not.toHaveBeenCalled();
});
it("does not issue uploads when storage permission is unavailable", async () => {
  state.allowed = false;
  render();
  await choose();
  expect(state.upload).not.toHaveBeenCalled();
});

it("resolves a task folder before the first upload and retains it for attachment retries", async () => {
  state.resolve.mockResolvedValue({ deliveryFolder: { id: "automatic-task-folder" } });
  state.upload.mockResolvedValue({ mediaAssetId: "media" });
  state.attach
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue({ id: "node", name: "Film" });
  render("task-a", null);
  await choose();
  expect(state.resolve).toHaveBeenCalledWith("/crew-tasks/task-a/delivery-folder", {
    body: { deliveryFolderId: null },
    signal: expect.any(AbortSignal),
  });
  expect(state.resolve.mock.invocationCallOrder[0]).toBeLessThan(
    state.upload.mock.invocationCallOrder[0]
  );
  expect(state.attach.mock.calls[0][1].parentId).toBe("automatic-task-folder");
  await retry();
  expect(state.resolve).toHaveBeenCalledTimes(1);
  expect(state.upload).toHaveBeenCalledTimes(1);
  expect(state.attach.mock.calls[1][1].parentId).toBe("automatic-task-folder");
});
it("does not upload to the root when folder resolution fails", async () => {
  state.resolve.mockRejectedValueOnce(new Error("Category folder is restricted"));
  render("task-a", null);
  await choose();
  expect(state.upload).not.toHaveBeenCalled();
  expect(state.attach).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Category folder is restricted");
  state.resolve.mockResolvedValue({ deliveryFolder: { id: "recovered-folder" } });
  state.upload.mockResolvedValue({ mediaAssetId: "media" });
  state.attach.mockResolvedValue({ id: "node", name: "Film" });
  await retry();
  expect(state.attach.mock.calls[0][1].parentId).toBe("recovered-folder");
});
