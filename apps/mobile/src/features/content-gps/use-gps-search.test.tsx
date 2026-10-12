import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useGpsSearch } from "./use-gps-search";
import type { GpsQuery } from "./search-api";
import { normalizeGpsDraft, EMPTY_GPS_DRAFT } from "./search-draft";
import { ApiRequestError } from "@/lib/api-client";
const emptyGpsQuery = normalizeGpsDraft(EMPTY_GPS_DRAFT, "en-US").data!;
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./search-api", async (original) => ({
  ...(await original<typeof import("./search-api")>()),
  searchGps: h.load,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/api-client", () => ({
  api: {},
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({
  generation = 1,
  enabled = true,
  query = emptyGpsQuery,
  locale = "en-US",
  selected = null,
  viewport = null,
}: {
  generation?: number;
  enabled?: boolean;
  query?: GpsQuery;
  locale?: string;
  selected?: string | null;
  viewport?: {
    coordinateSystem: "WGS84";
    west: number;
    east: number;
    south: number;
    north: number;
  } | null;
}) {
  const options = useMemo(
    () => ({
      selectedIpId: selected,
      placeSearch: "",
      coordinateSystem: "WGS84" as const,
      viewport: viewport ?? undefined,
    }),
    [selected, viewport]
  );
  const s = useGpsSearch(
    { generation, viewerId: generation === 1 ? null : "viewer" },
    query,
    locale,
    enabled,
    options
  );
  return (
    <div>
      {s.items.map((i) => (
        <span key={i.id}>{i.title}</span>
      ))}
      {s.page?.selected?.title}
      {s.error}
      <button onClick={s.loadMore}>more</button>
      <button onClick={s.retry}>retry</button>
      <button onClick={s.refresh}>refresh</button>
    </div>
  );
}
const render = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));
const click = (index: number) => act(async () => host.querySelectorAll("button")[index]!.click());
const page = (id = "1", next: string | null = "1") => ({
  queryId: "a".repeat(64),
  items: [{ id, title: `IP ${id}` }],
  nextCursor: next ? { afterId: next, queryId: "a".repeat(64) } : null,
  matchedCount: 3,
  accessibleCount: 4,
  requiresLogin: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  h.load.mockResolvedValue(page());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("serializes paging and retries a failed cursor only on explicit retry", async () => {
  await render();
  h.load.mockRejectedValueOnce(new Error("Offline"));
  await click(0);
  expect(host.textContent).toContain("IP 1Offline");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  h.load.mockResolvedValueOnce(page("2", null));
  await click(1);
  expect(h.load.mock.calls[2][2]).toEqual(page().nextCursor);
  expect(host.textContent).toContain("IP 1IP 2");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(3);
});
it.each([400, 403, 409])("clears invalid or denied paging (%s) and restarts", async (status) => {
  await render();
  h.load.mockRejectedValueOnce(new ApiRequestError("DENIED", "No access", status));
  await click(0);
  expect(host.textContent).not.toContain("IP 1");
  expect(host.textContent).toContain("No access");
  await click(1);
  expect(h.load.mock.calls[2][2]).toBeNull();
});
it("rejects a changed count or duplicate page and restarts rather than keeping stale cards", async () => {
  await render();
  h.load.mockResolvedValueOnce({ ...page("2"), matchedCount: 1 });
  await click(0);
  expect(host.textContent).toContain("results changed");
  expect(host.textContent).not.toContain("IP 1");
  await click(1);
  expect(h.load.mock.calls[2][2]).toBeNull();
  h.load.mockResolvedValueOnce(page());
  await click(0);
  expect(host.textContent).toContain("results changed");
});
it("does not fetch while inactive and clears old identities on account, locale or filter changes", async () => {
  await render({ enabled: false });
  expect(h.load).not.toHaveBeenCalled();
  await render();
  expect(host.textContent).toContain("IP 1");
  let finish!: (v: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await click(0);
  const s = h.load.mock.calls[1][4];
  h.load.mockResolvedValueOnce({ ...page("fresh", null) });
  await render({
    generation: 2,
    locale: "zh-CN",
    query: { ...emptyGpsQuery, genreCodes: ["new"] },
  });
  expect(s.aborted).toBe(true);
  await act(async () => finish(page("old", null)));
  expect(host.textContent).toContain("IP fresh");
  expect(host.textContent).not.toContain("IP old");
  expect(host.textContent).not.toContain("IP 1");
  await render({ enabled: false });
  expect(host.textContent).not.toContain("IP fresh");
});

it("resets paging and hides previous selection while a new link resolves", async () => {
  h.load.mockResolvedValueOnce({ ...page(), selected: { id: "a", title: "Selected A" } });
  await render({ selected: "a" });
  expect(host.textContent).toContain("Selected A");
  expect(h.load.mock.calls[0][5].selectedIpId).toBe("a");
  let finish!: (v: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render({ selected: "b" });
  expect(host.textContent).not.toContain("Selected A");
  expect(h.load.mock.calls[1][2]).toBeNull();
  expect(h.load.mock.calls[1][5].selectedIpId).toBe("b");
  await act(async () => finish({ ...page("2", null), selected: { id: "b", title: "Selected B" } }));
  expect(host.textContent).toContain("Selected B");
  await render({ enabled: false, selected: "b" });
  expect(host.textContent).not.toContain("Selected B");
});

it("aborts paging on map movement and ignores late results from the previous viewport", async () => {
  const viewport = {
    coordinateSystem: "WGS84" as const,
    west: 100,
    east: 120,
    south: 0,
    north: 20,
  };
  await render({ viewport });
  let finish!: (v: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await click(0);
  const oldSignal = h.load.mock.calls[1][4];
  const nextViewport = { ...viewport, east: 130 };
  h.load.mockResolvedValueOnce(page("fresh", null));
  await render({ viewport: nextViewport });
  expect(oldSignal.aborted).toBe(true);
  expect(h.load.mock.calls[2][2]).toBeNull();
  expect(h.load.mock.calls[2][5].viewport).toEqual(nextViewport);
  await act(async () => finish(page("old", null)));
  expect(host.textContent).toContain("IP fresh");
  expect(host.textContent).not.toContain("IP old");
  expect(host.textContent).not.toContain("IP 1");
});

it("clears previous results while revalidating after returning", async () => {
  let finish!: (value: unknown) => void;
  await render();
  expect(host.querySelectorAll("span").length).toBeGreaterThan(0);
  await render({ enabled: false });
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  expect(host.querySelectorAll("span")).toHaveLength(0);
  await act(async () => finish(page("fresh", null)));
  expect(host.textContent).toContain("fresh");
});
