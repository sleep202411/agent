// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CharacterMediaBoard } from "./character-media-board";
import type { CharacterDetail } from "@/lib/characters-api";
const s = vi.hoisted(() => ({
  user: "a",
  upload: vi.fn(),
  attach: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  detail: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: s.user } }) }));
vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: s.upload,
  isUploadAbort: () => false,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: s.error, info: vi.fn() } }));
vi.mock("@/lib/characters-api", async (original) => ({
  ...(await original<typeof import("@/lib/characters-api")>()),
  attachCharacterMedia: s.attach,
  updateCharacter: s.update,
  removeCharacterMedia: s.remove,
  reorderCharacterMedia: s.reorder,
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
const detail = {
  id: "c",
  workspaceId: "character-workspace",
  kind: "virtual",
  media: [
    { id: "m1", mediaAssetId: "a1", mediaKind: "image", sortOrder: 0 },
    { id: "m2", mediaAssetId: "a2", mediaKind: "image", sortOrder: 1 },
  ],
} as CharacterDetail;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  s.user = "a";
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <CharacterMediaBoard character={detail} onDetail={s.detail} />
        </TooltipProvider>
      </QueryClientProvider>
    )
  );
}
it("admits only one rapid cover/reorder operation and ignores abandoned completion", async () => {
  let resolve!: (v: unknown) => void;
  s.update.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="setAsCover"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="moveLater"]')!.click();
  });
  expect(s.update).toHaveBeenCalledTimes(1);
  expect(s.reorder).not.toHaveBeenCalled();
  const signal = s.update.mock.calls[0][2] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(detail));
  expect(s.detail).not.toHaveBeenCalled();
});
it("keeps failed cover changes retryable", async () => {
  s.update.mockRejectedValueOnce(new Error("cover failed")).mockResolvedValue(detail);
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="setAsCover"]')!.click()
  );
  expect(s.error).toHaveBeenCalledWith("cover failed");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="setAsCover"]')!.click()
  );
  expect(s.update).toHaveBeenCalledTimes(2);
  expect(s.detail).toHaveBeenCalledWith(detail);
});
it("guards removal confirmation and cancels its old response", async () => {
  let resolve!: (value: unknown) => void;
  s.remove.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="removeMedia"]')!.click()
  );
  await act(async () => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "remove"
    )!;
    button.click();
    button.click();
  });
  expect(s.remove).toHaveBeenCalledTimes(1);
  const signal = s.remove.mock.calls[0][2] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(detail));
  expect(s.detail).not.toHaveBeenCalled();
});

it("does not attach an upload returned after account cancellation", async () => {
  let resolve!: (v: unknown) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "a.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(s.upload.mock.calls[0][1].workspaceId).toBe("character-workspace");
  const signal = s.upload.mock.calls[0][1].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ mediaAssetId: "late" }));
  expect(s.attach).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
it("reserves upload capacity synchronously across rapid file selections", async () => {
  s.upload.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: Array.from(
        { length: 7 },
        (_, i) => new File(["x"], `${i}.png`, { type: "image/png" })
      ),
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(s.upload).toHaveBeenCalledTimes(7);
});
