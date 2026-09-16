// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { GameIpLink } from "./game-ip-link";
import { IpGameAssociations } from "@/app/(site)/ips/_components/ip-game-associations";
import { IpStageApplications } from "@/app/(site)/ips/_components/ip-stage-applications";

vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "owner" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const gameId = "11111111-1111-4111-8111-111111111111";
const ipId = "22222222-2222-4222-8222-222222222222";
let root: Root | undefined;
let host: HTMLDivElement;
let client: QueryClient;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  client?.clear();
  root = undefined;
  vi.unstubAllGlobals();
});

it.each([null, ipId])(
  "reads the controller's flat success body through the real TV client: %s",
  async (resolvedIp) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: 200, ipId: resolvedIp })));
    await mount(<GameIpLink gameKey={`interactive-film:${gameId}`} />);
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href") ?? null).toBe(
      resolvedIp ? `/en-US/ips/${ipId}` : null
    );
  }
);

it("loads owner candidates and acknowledges a save through the real envelope client", async () => {
  const game = { gameId, title: "Owned film", version: 0, linked: false, linkedElsewhere: false };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ code: 200, items: [game], nextCursor: null }))
    .mockResolvedValueOnce(json({ code: 200, version: 1, active: true }))
    .mockResolvedValueOnce(
      json({ code: 200, items: [{ ...game, version: 1, linked: true }], nextCursor: null })
    );
  vi.stubGlobal("fetch", fetcher);
  await mount(<IpGameAssociations ipId={ipId} />);
  await flush();
  const link = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "link"
  )!;
  expect(link).toBeDefined();
  await act(async () => link.click());
  await flush();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "unlink")
  ).toBe(true);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include" });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    expectedVersion: 0,
    active: true,
  });
});

it("keeps an HTTP permission failure visible rather than inventing an association", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "Access denied" }, 403)));
  await mount(<GameIpLink gameKey={`interactive-film:${gameId}`} />);
  await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Access denied");
  expect(host.querySelector("a")).toBeNull();
});

it("loads stage history and retains the server's acknowledged application", async () => {
  const item = {
    id: gameId,
    stage: "story_testing",
    status: "pending",
    reason: "Ready for review",
    reviewReason: null,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ code: 200, state: { stage: "testing", version: 2 }, items: [] }))
    .mockResolvedValueOnce(json({ code: 200, ...item }));
  vi.stubGlobal("fetch", fetcher);
  await mount(<IpStageApplications ipId={ipId} />);
  await flush();
  const field = host.querySelector("textarea")!;
  expect(field).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      item.reason
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("article")?.textContent).toContain(item.reason);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("awaiting");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    expectedVersion: 2,
    stage: "story_testing",
    reason: item.reason,
  });
});
