// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { TvGames } from "./tv-games";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), user: { id: "a" } }));
vi.mock("@/src/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => state.get(...args),
    post: (...args: unknown[]) => state.post(...args),
  },
}));
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
  state.post.mockReset();
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
  expect(host.querySelector("aside")).toBeNull();
  expect(host.querySelector("iframe")?.title).toBe("player");
  const back = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "backToGames"
  )!;
  await act(async () => back.click());
  expect(host.querySelector("aside")).not.toBeNull();
  expect(host.querySelector("iframe")).toBeNull();
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

it("shows interactive films before text adventures and opens the film route", async () => {
  state.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/games")
        ? [
            {
              gameId: "film-one",
              title: "Interactive story",
              currentVersion: "v1",
              updatedAt: "2026-09-15T10:00:00Z",
              status: "published",
              offlineAt: null,
            },
          ]
        : [
            {
              gameId: "tg_1234567890123456",
              name: "Text story",
              posterUrl: null,
              synopsis: null,
              status: "published",
            },
          ]
    )
  );
  await mount();
  const rows = Array.from(host.querySelectorAll("button[aria-pressed]"));
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "Interactive story",
    "Text story",
  ]);
  expect(Array.from(host.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
    "films.title",
    "textGames.title",
  ]);
  await act(async () => (rows[0] as HTMLButtonElement).click());
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(
    "/en-US/play/interactive-film/film-one"
  );
  expect(host.querySelector("aside")).not.toBeNull();
});

it("shows the publishing user's display name and an accessible full-player icon", async () => {
  state.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/games")
        ? [
            {
              gameId: "game-one",
              title: "Original title",
              creatorId: 13425,
              currentVersion: "v1",
              updatedAt: "2026-07-16T16:17:58+08:00",
            },
          ]
        : []
    )
  );
  state.post.mockResolvedValue({ info: { id: 13425, nickName: "Asitaka" } });
  await mount();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Original title"]')!;
  expect(button.textContent).toContain("Asitaka");
  expect(state.post).toHaveBeenCalledWith(
    "/user/other/user/info",
    expect.objectContaining({ params: { UserId: "13425" }, raw: true })
  );
  await act(async () => button.click());
  const link = host.querySelector('a[aria-label="open"]')!;
  expect(link.querySelector("svg")).not.toBeNull();
  expect(link.textContent).toBe("");
  expect(link.getAttribute("href")).toBe("/en-US/play/interactive-film/game-one");
});
it("does not substitute the viewer or a numeric ID when the publisher lookup fails", async () => {
  state.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/games")
        ? [
            {
              gameId: "game-one",
              title: "Original title",
              creatorId: 13425,
              currentVersion: "v1",
              updatedAt: "2026-07-16T16:17:58+08:00",
            },
          ]
        : []
    )
  );
  state.post.mockRejectedValue(new Error("Unavailable"));
  await mount();
  expect(host.querySelector('button[aria-label="Original title"]')?.textContent).toBe(
    "Original title"
  );
});

it("resolves text-adventure publisher names through the same public profile lookup", async () => {
  state.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/games")
        ? []
        : [
            {
              gameId: "tg_1234567890123456",
              name: "Original text adventure",
              creatorId: "13425",
              posterUrl: null,
              synopsis: null,
              status: "published",
            },
          ]
    )
  );
  state.post.mockResolvedValue({ info: { id: 13425, nickName: "Asitaka" } });
  await mount();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  const button = host.querySelector('button[aria-label="Original text adventure"]')!;
  expect(button.textContent).toContain("Asitaka");
  expect(state.post).toHaveBeenCalledTimes(1);
});
