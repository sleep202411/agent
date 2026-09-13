// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { TvGames } from "./tv-games";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ get: vi.fn(), user: { id: "a" } }));
vi.mock("@/src/lib/api", () => ({ api: { get: (...args: unknown[]) => state.get(...args) } }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: state.user }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/i18n/locale-url", () => ({ localizePath: (path: string) => `/en-US${path}` }));
let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  state.get.mockReset();
  state.user = { id: "a" };
});
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <TvGames />
      </QueryClientProvider>
    );
  await act(async () => {
    render();
    await new Promise((r) => setTimeout(r, 25));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
  return render;
}
it("retains the available catalog when the other fails and launches only its player", async () => {
  state.get.mockImplementation((url: string) =>
    url.endsWith("/games")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([
          {
            gameId: "tg_1234567890123456",
            name: "Adventure",
            posterUrl: null,
            synopsis: null,
            status: "published",
          },
        ])
  );
  await mount();
  expect(host.textContent).toContain("failed");
  const button = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "Adventure"
  )!;
  await act(async () => button.click());
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(
    "/en-US/play/text-game/tg_1234567890123456"
  );
  expect(state.get.mock.calls.every(([url]) => String(url).startsWith("/api/player/"))).toBe(true);
});
it("cancels abandoned catalogs and does not carry selection into another account", async () => {
  const signals: AbortSignal[] = [];
  state.get.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    return new Promise(() => {});
  });
  const render = await mount();
  state.user = { id: "b" };
  await act(async () => {
    render();
  });
  expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
  expect(host.querySelector("iframe")).toBeNull();
});
