// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
import { IpGameAssociations } from "./ip-game-associations";
import { GameIpLink } from "@/app/tv/_components/game-ip-link";
const state = vi.hoisted(() => ({ id: "owner", get: vi.fn(), post: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/src/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => state.get(...args),
    post: (...args: unknown[]) => state.post(...args),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const gameId = "00000000-0000-4000-8000-000000000001";
const data = {
  items: [{ gameId, title: "Owned game", version: 0, linked: false, linkedElsewhere: false }],
  nextCursor: null,
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.resetAllMocks();
  state.id = "owner";
});
async function mount(view: () => React.ReactNode) {
  host = document.createElement("div");
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = () =>
    root.render(<QueryClientProvider client={client}>{view()}</QueryClientProvider>);
  await act(async () => render());
  await flush();
  return render;
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
it("retries failed writes with the same identity and blocks overlapping actions", async () => {
  state.get.mockResolvedValue(data);
  state.post.mockRejectedValueOnce(new Error("Retry this request")).mockResolvedValue({});
  await mount(() => <IpGameAssociations ipId="ip" />);
  await act(async () => {
    button("link").click();
    button("link").click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Retry this request");
  await act(async () => button("link").click());
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.post.mock.calls[0][1].data).toEqual(state.post.mock.calls[1][1].data);
});
it("cancels abandoned reads and suppresses old-account candidates", async () => {
  let finish!: (value: typeof data) => void;
  let signal!: AbortSignal;
  state.get
    .mockImplementationOnce((_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue({ items: [], nextCursor: null });
  const render = await mount(() => <IpGameAssociations ipId="ip" />);
  state.id = "other";
  await act(async () => render());
  await flush();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(data));
  expect(host.textContent).not.toContain("Owned game");
});
it("links only a server-resolved IP and cancels a replaced game lookup", async () => {
  state.get.mockResolvedValue({ ipId: "verified-ip" });
  let key = `interactive-film:${gameId}`;
  const render = await mount(() => <GameIpLink gameKey={key} />);
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/en-US/ips/verified-ip");
  key = "text-game:legacy";
  await act(async () => render());
  expect(host.querySelector("a")).toBeNull();
  expect(state.get).toHaveBeenCalledTimes(1);
});
