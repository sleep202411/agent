// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetSelectDialog } from "./asset-select-dialog";
const mock = vi.hoisted(() => ({
  assets: [] as Array<{ id: string; kind: "image"; url: string; name: string }>,
  upload: vi.fn(),
  probe: vi.fn(),
  add: vi.fn(),
  filter: vi.fn(),
  error: vi.fn(),
  canEdit: true,
  userId: "a",
  workspace: "workspace",
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: mock.userId } }),
}));
vi.mock("@/components/media/canvas-video", () => ({ CanvasVideo: () => null }));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => ({ id: mock.workspace }),
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => ({ addAssets: mock.add, canEdit: mock.canEdit }),
}));
vi.mock("@/lib/canvas-authoring/use-project-assets", () => ({
  useProjectAssets: () => ({
    assets: mock.assets,
    filtered: mock.assets,
    filter: "all",
    setFilter: mock.filter,
    isLoading: false,
  }),
  projectAssetToMentionItem: (asset: { id: string }) => ({ id: asset.id, label: asset.id }),
}));
vi.mock("@/components/canvas/authoring/use-media-authoring-canvas", () => ({
  canvasAcceptedFileTypes: () => "video/mp4",
  canvasUploadMediaKind: () => "video",
}));
vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: mock.upload,
  isUploadAbort: (e: Error) => e.name === "AbortError",
}));
vi.mock("@/lib/canvas-authoring/probe-media-duration", () => ({
  probeMediaDurationSeconds: mock.probe,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let project = "one";
let open = true;
const render = () =>
  root.render(
    <AssetSelectDialog
      open={open}
      projectId={project}
      onClose={() => {
        open = false;
        render();
      }}
      onSelect={() => {}}
    />
  );
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  project = "one";
  open = true;
  mock.canEdit = true;
  mock.userId = "a";
  mock.probe.mockResolvedValue(10);
  act(() => render());
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
function upload(count = 1) {
  const input = host.querySelector("input[type=file]")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: Array.from({ length: count }, () => new File(["x"], "x.mp4", { type: "video/mp4" })),
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
it("blocks same-tick duplicate starts and cancels queued publication on project change", async () => {
  let finish!: (value: unknown) => void;
  mock.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  act(() => {
    upload(2);
    upload(2);
  });
  expect(mock.upload).toHaveBeenCalledTimes(1);
  const signal = mock.upload.mock.calls[0][1].signal as AbortSignal;
  project = "two";
  act(() => render());
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ mediaAssetId: "old", url: "old" }));
  expect(mock.add).not.toHaveBeenCalled();
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.filter).not.toHaveBeenCalled();
});
it("allows close during upload and suppresses delayed errors", async () => {
  let reject!: (e: Error) => void;
  mock.upload.mockImplementation(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      })
  );
  act(() => upload());
  const signal = mock.upload.mock.calls[0][1].signal as AbortSignal;
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="assetDialog.close"]')!.click());
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("old failure")));
  expect(mock.error).not.toHaveBeenCalled();
});
it("keeps replacement pending when an abandoned request finishes and cancels on edit loss", async () => {
  const finishes: Array<(value: unknown) => void> = [];
  mock.upload.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
  act(() => upload());
  project = "two";
  act(() => render());
  act(() => upload());
  await act(async () => finishes[0]!({ mediaAssetId: "old", url: "old" }));
  act(() => upload());
  expect(mock.upload).toHaveBeenCalledTimes(2);
  mock.canEdit = false;
  act(() => render());
  expect(mock.upload.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => finishes[1]!({ mediaAssetId: "new", url: "new" }));
  expect(mock.add).not.toHaveBeenCalled();
});
it("retains successful files when another file fails and releases the failed probe", async () => {
  mock.upload
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValueOnce({ mediaAssetId: "ok", url: "ok" });
  await act(async () => upload(2));
  expect(mock.error).toHaveBeenCalledWith("Storage unavailable");
  expect(mock.add).toHaveBeenCalledTimes(1);
  expect(mock.probe.mock.calls[0][2].aborted).toBe(true);
  expect(mock.filter).toHaveBeenCalledWith("uploaded");
});

it("clears unavailable selections and lets the user replace them", async () => {
  const select = vi.fn();
  const display = () =>
    root.render(
      <AssetSelectDialog
        open
        projectId="project"
        onClose={() => {}}
        onSelect={select}
        maxSelection={2}
      />
    );
  mock.assets = [{ id: "crew", kind: "image", url: "/crew.png", name: "Crew image" }];
  await act(async () => display());
  await act(async () => host.querySelector<HTMLImageElement>('img[alt="Crew image"]')!.click());
  const confirm = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "assetDialog.confirm")!;
  expect(confirm().disabled).toBe(false);
  mock.assets = [{ id: "local", kind: "image", url: "/local.png", name: "Local image" }];
  await act(async () => display());
  expect(confirm().disabled).toBe(true);
  await act(async () => host.querySelector<HTMLImageElement>('img[alt="Local image"]')!.click());
  await act(async () => confirm().click());
  expect(select).toHaveBeenCalledExactlyOnceWith({ id: "local", label: "local" });
  mock.assets = [];
});
