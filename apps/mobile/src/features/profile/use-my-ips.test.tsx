import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useMyIps } from "./use-my-ips";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  active: true,
  locale: "en-US",
  version: 0,
  t: (key: string) => key,
}));
vi.mock("@/data/ip-api", () => ({ fetchMyIpsPage: h.load }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => h.version }));
vi.mock("@/i18n", () => ({ useLocale: () => h.locale, useTranslations: () => h.t }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const page = (id = "one", nextCursor: string | null = "one") => ({
  items: [{ id, title: id }],
  nextCursor,
});
function Probe({ owner }: { owner?: string }) {
  const state = useMyIps(owner);
  return (
    <div>
      {state.items?.map((item) => (
        <span key={item.id}>{item.title}</span>
      ))}
      {state.loading && "loading"}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
      <button onClick={state.refresh}>refresh</button>
    </div>
  );
}
const render = (owner?: string) => act(async () => root.render(<Probe owner={owner} />));
const click = (i: number) => act(async () => host.querySelectorAll("button")[i]!.click());
beforeEach(() => {
  h.load.mockReset();
  h.locale = "en-US";
  h.version = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("does not fetch for guests and follows cursors without duplicating rows", async () => {
  await render();
  expect(h.load).not.toHaveBeenCalled();
  h.load.mockResolvedValueOnce(page()).mockResolvedValueOnce({
    items: [
      { id: "one", title: "updated" },
      { id: "two", title: "two" },
    ],
    nextCursor: null,
  });
  await render("alice:1");
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1]?.[0]).toBe("one");
  expect(host.querySelectorAll("span")).toHaveLength(2);
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("preserves current rows on transport failure and retries the same cursor explicitly", async () => {
  h.load
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page("two", null));
  await render("alice:1");
  await click(0);
  expect(host.textContent).toContain("oneoffline");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2]?.[0]).toBe("one");
  expect(host.textContent).toContain("two");
});
it("clears private rows after access denial and rechecks from the first page", async () => {
  h.load
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }))
    .mockResolvedValueOnce(page("restored", null));
  await render("alice:1");
  await click(0);
  expect(host.querySelectorAll("span")).toHaveLength(0);
  expect(host.textContent).toContain("denied");
  await click(1);
  expect(h.load.mock.calls[2]?.[0]).toBe(null);
});
it("aborts previous accounts and ignores late results", async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    )
    .mockResolvedValueOnce(page("bob", null));
  await render("alice:1");
  const signal = h.load.mock.calls[0]?.[1];
  await render("bob:2");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(page("alice")));
  expect(host.textContent).toContain("bob");
  expect(host.textContent).not.toContain("alice");
  await render();
  expect(host.querySelectorAll("span")).toHaveLength(0);
});
it("refreshes on locale, browse invalidation and explicit refresh", async () => {
  h.load.mockResolvedValue(page("first", null));
  await render("alice:1");
  h.locale = "zh-HK";
  h.load.mockResolvedValue(page("localized", null));
  await render("alice:1");
  expect(host.textContent).toContain("localized");
  h.version++;
  h.load.mockResolvedValue(page("changed", null));
  await render("alice:1");
  expect(host.textContent).toContain("changed");
  h.load.mockResolvedValue(page("refreshed", null));
  await click(2);
  expect(host.textContent).toContain("refreshed");
  expect(h.load).toHaveBeenCalledTimes(4);
});
it("stops cursor cycles without appending another page", async () => {
  h.load.mockResolvedValueOnce(page()).mockResolvedValueOnce(page("two", "one"));
  await render("alice:1");
  await click(0);
  expect(host.textContent).toContain("Invalid owned IP cursor");
  expect(host.textContent).not.toContain("two");
});

it("requires fresh owned IPs after a return visit", async () => {
  let finish!: (value: unknown) => void;
  h.load.mockResolvedValueOnce(page()).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render("alice:1");
  await render();
  await render("alice:1");
  expect(host.querySelectorAll("span")).toHaveLength(0);
  expect(host.textContent).toContain("loading");
  await act(async () => finish(page("fresh", null)));
  expect(host.textContent).toContain("fresh");
});

it("clears stale IPs while backgrounded and reloads ownership on return", async () => {
  h.load.mockResolvedValueOnce(page("old", null)).mockResolvedValueOnce(page("updated", null));
  await render("alice");
  const signal = h.load.mock.calls[0][1];
  h.active = false;
  await render("alice");
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("old");
  h.active = true;
  await render("alice");
  expect(host.textContent).toContain("updated");
  expect(h.load.mock.calls[1][0]).toBeNull();
});
