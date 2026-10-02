import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useCrewAssets } from "./use-crew-assets";
import type { AssetQuery } from "./api";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./api", () => ({ fetchCrewAssets: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: AssetQuery }) {
  const state = useCrewAssets(owner, "crew", role);
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.name}</span>
      ))}
      {state.error}
      {state.accessDenied && <span>Denied</span>}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: AssetQuery = {}) =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", name: "First" };
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads only authenticated scopes, advances cursors and deduplicates items", async () => {
  await render();
  expect(h.load).not.toHaveBeenCalled();
  h.load.mockResolvedValueOnce({ items: [item], nextCursor: "next" }).mockResolvedValueOnce({
    items: [item, { id: "two", name: "Second" }],
    nextCursor: null,
  });
  await render("1");
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1][2]).toBe("next");
  expect(host.textContent?.match(/First/g)).toHaveLength(1);
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("keeps loaded rows and retries the failed cursor explicitly", async () => {
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("Firstoffline");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][2]).toBe("next");
});
it("aborts old scopes and ignores late responses after account or filter changes", async () => {
  let finish!: (value: unknown) => void;
  h.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ items: [], nextCursor: null });
  await render("1");
  const signal = h.load.mock.calls[0][3];
  await render("2", { source: "favorites" });
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load.mock.calls[1].slice(0, 3)).toEqual(["crew", { source: "favorites" }, null]);
});
it("stops repeated cursors instead of looping forever", async () => {
  h.load.mockResolvedValue({ items: [item], nextCursor: "same" });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("did not advance");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("continues through an ACL-filtered empty page", async () => {
  h.load
    .mockResolvedValueOnce({ items: [], nextCursor: "hidden-boundary" })
    .mockResolvedValueOnce({ items: [item], nextCursor: null });
  await render("1");
  await click(0);
  expect(h.load.mock.calls[1][2]).toBe("hidden-boundary");
  expect(host.textContent).toContain("First");
});
it.each([401, 403, 404, 410])(
  "clears revoked data for %s and restarts pagination on explicit retry",
  async (status) => {
    h.load
      .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
      .mockRejectedValueOnce(Object.assign(new Error("Access revoked"), { status }))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await render("1");
    await click(0);
    expect(host.textContent).not.toContain("First");
    expect(host.textContent).toContain("Access revoked");
    expect(host.textContent).toContain("Denied");
    await click(1);
    expect(h.load.mock.calls[2][2]).toBeNull();
    expect(host.textContent).not.toContain("Denied");
  }
);

it("does not restore stale rows while revalidating a return visit", async () => {
  let finish!: (value: unknown) => void;
  h.load.mockResolvedValueOnce({ items: [item], nextCursor: null }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render("1");
  expect(host.textContent).toContain("First");
  await render();
  await render("1");
  expect(host.textContent).not.toContain("First");
  await act(async () => finish({ items: [], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load).toHaveBeenCalledTimes(2);
});
