// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventureAccount } from "./text-adventure-account";
import { TextAdventureCreateDialog } from "./text-adventure-create-dialog";
const s = vi.hoisted(() => ({ user: "a", upload: vi.fn(), create: vi.fn(), replace: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: s.user },
    loading: false,
    isCurrentAccount: (id: string) => s.user === id,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: s.replace }) }));
vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: s.upload,
  isUploadAbort: () => false,
}));
vi.mock("../_lib/text-adventure-api", async (original) => ({
  ...(await original<typeof import("../_lib/text-adventure-api")>()),
  createCreatorTextAdventure: s.create,
}));
vi.mock("./text-adventure-workbench", () => ({
  TextAdventureWorkbenchSkeleton: () => <div>Creating</div>,
}));
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TextAdventureAccount>
          {(userId) => <TextAdventureCreateDialog userId={userId} open onOpenChange={() => {}} />}
        </TextAdventureAccount>
      </QueryClientProvider>
    )
  );
}
async function upload(twice = false) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["fixture"], "world.docx")],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (twice) input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.upload.mockReset();
  s.create.mockReset();
  s.replace.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  client.clear();
});
it("does not create a work when an abandoned upload finishes", async () => {
  let resolve!: (value: { url: string }) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload(true);
  expect(s.upload).toHaveBeenCalledTimes(1);
  const signal = s.upload.mock.calls[0][1].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ url: "https://fixture.invalid/world.docx" }));
  expect(s.create).not.toHaveBeenCalled();
  expect(s.replace).not.toHaveBeenCalled();
});
it("does not navigate or cache an old account's late creation", async () => {
  s.upload.mockResolvedValue({ url: "https://fixture.invalid/world.docx" });
  let resolve!: (value: { gameId: string }) => void;
  s.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload();
  expect(s.create).toHaveBeenCalledTimes(1);
  s.user = "b";
  await render();
  expect(s.create.mock.calls[0][1].aborted).toBe(true);
  await act(async () => resolve({ gameId: "tg_0123456789abcdef" }));
  expect(s.replace).not.toHaveBeenCalled();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
it("caches and opens a completed creation for its owner", async () => {
  s.upload.mockResolvedValue({ url: "https://fixture.invalid/world.docx" });
  s.create.mockResolvedValue({ gameId: "tg_0123456789abcdef" });
  await render();
  await upload();
  expect(client.getQueryData(["text-adventures", "detail", "tg_0123456789abcdef", "a"])).toEqual({
    gameId: "tg_0123456789abcdef",
  });
  expect(s.replace).toHaveBeenCalledWith("/text-adventures/tg_0123456789abcdef");
});
