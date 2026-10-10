import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useOrders } from "./use-orders";
import type { OrderRole } from "./order-list-api";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./order-list-api", () => ({ fetchOrders: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: OrderRole }) {
  const state = useOrders(owner, role, "");
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.serviceTitle}</span>
      ))}
      {state.error}
      {state.loading && <em>Loading</em>}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: OrderRole = "both") =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", serviceTitle: "First" };
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
    items: [item, { id: "two", serviceTitle: "Second" }],
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
it("aborts old scopes and ignores late responses after account or role changes", async () => {
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
  await render("2", "creator");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load.mock.calls[1].slice(0, 3)).toEqual(["creator", "", null]);
});
it("stops repeated cursors instead of looping forever", async () => {
  h.load.mockResolvedValue({ items: [item], nextCursor: "same" });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("did not advance");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});

it("revalidates return visits without showing the previous visit's rows", async () => {
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
  expect(host.textContent).toContain("Loading");
  await act(async () => finish({ items: [], nextCursor: null }));
  expect(host.textContent).not.toContain("Loading");
  expect(h.load).toHaveBeenCalledTimes(2);
});

it.each([401, 403])(
  "clears private order summaries on %s and restarts after explicit retry",
  async (status) => {
    h.load
      .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
      .mockRejectedValueOnce(Object.assign(new Error("Access denied"), { status }))
      .mockResolvedValueOnce({
        items: [{ ...item, serviceTitle: "Revalidated" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await render("1");
    await click(0);
    expect(host.textContent).not.toContain("First");
    expect(host.textContent).toContain("Access denied");
    await click(0);
    expect(h.load).toHaveBeenCalledTimes(2);
    await click(1);
    expect(h.load.mock.calls[2][2]).toBeNull();
    expect(host.textContent).toContain("Revalidated");
    expect(host.textContent).not.toContain("Access denied");
    await click(0);
    expect(h.load.mock.calls[3][2]).toBe("next");
  }
);
