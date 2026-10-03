// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventureWorkbench } from "./text-adventure-workbench";
const s = vi.hoisted(() => ({
  user: "a",
  get: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: s.user },
    loading: false,
    isCurrentAccount: (id: string) => s.user === id,
  }),
}));
vi.mock("@/app/_components/region-provider", () => ({ useSiteRegion: () => "com" }));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/lib/web-base", () => ({ getWebBaseUrl: () => "https://fixture.invalid" }));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: s.upload }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("../_lib/text-adventure-api", async (original) => ({
  ...(await original<typeof import("../_lib/text-adventure-api")>()),
  getCreatorTextAdventure: s.get,
  updateCreatorTextAdventure: s.update,
}));
const gameId = "tg_0123456789abcdef";
function detail(name: string) {
  return {
    gameId,
    status: "draft",
    draftVersionId: "1",
    publishedVersionId: null,
    updatedAt: "2026-10-03T00:00:00Z",
    content: {
      versionNo: 1,
      name,
      synopsis: "Story",
      posterUrl: "",
      worldviewDocxUrl: "",
      bgmUrl: null,
      characters: [],
      stillUrls: [],
    },
  };
}
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TextAdventureWorkbench adventureId={gameId} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.get
    .mockReset()
    .mockImplementation(() => Promise.resolve(detail(s.user === "a" ? "Private A" : "Private B")));
  s.update.mockReset();
  s.upload.mockReset();
  s.success.mockReset();
  s.error.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  client.clear();
});
it("replaces an old account's editor with an independently loaded work", async () => {
  await render();
  expect(node.textContent).toContain("Private A");
  s.user = "b";
  await render();
  expect(node.textContent).not.toContain("Private A");
  expect(node.textContent).toContain("Private B");
  expect(s.get).toHaveBeenCalledTimes(2);
});
it("does not save an upload that completed after the account changed", async () => {
  let resolve!: (value: { url: string }) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    const input = node.querySelector<HTMLInputElement>('input[type="file"][accept^="image/"]')!;
    expect(input).toBeTruthy();
    Object.defineProperty(input, "files", {
      value: [new File(["fixture"], "poster.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const signal = s.upload.mock.calls[0][1].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ url: "https://fixture.invalid/poster.png" }));
  expect(s.update).not.toHaveBeenCalled();
  expect(s.success).not.toHaveBeenCalled();
  expect(s.error).not.toHaveBeenCalled();
  expect(node.textContent).toContain("Private B");
});
