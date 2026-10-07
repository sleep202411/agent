import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskOptions } from "./use-task-options";
type AssetQuery = { query?: string; recruitmentOnly?: boolean };
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./task-options", () => ({ fetchTaskOptions: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: AssetQuery }) {
  const state = useTaskOptions(owner, "crew", role);
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.title}</span>
      ))}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: AssetQuery = {}) =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", title: "First" };
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("loads only authenticated scopes, advances cursors and deduplicates items", async () => {
  await render();
  expect(h.load).not.toHaveBeenCalled();
  h.load.mockResolvedValueOnce({ items: [item], nextCursor: "next" }).mockResolvedValueOnce({
    items: [item, { id: "two", title: "Second" }],
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
  await render("2", { query: "scene" });
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load.mock.calls[1].slice(0, 3)).toEqual(["crew", { query: "scene" }, null]);
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
it("clears revoked data and restarts pagination on explicit retry", async () => {
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
    .mockRejectedValueOnce(Object.assign(new Error("Access revoked"), { status: 403 }))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).toContain("Access revoked");
  await click(1);
  expect(h.load.mock.calls[2][2]).toBeNull();
});

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

it("refreshes recruitable tasks and removes newly assigned rows, but stops when inactive", async () => {
  vi.useFakeTimers();
  h.load.mockResolvedValue({ items: [item], nextCursor: null });
  await render("1", { recruitmentOnly: true });
  h.load.mockResolvedValue({ items: [{ id: "new", title: "New task" }], nextCursor: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(host.textContent).toContain("New task");
  expect(host.textContent).not.toContain("First");
  h.load.mockRejectedValue(Object.assign(new Error("Access revoked"), { status: 403 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(host.textContent).not.toContain("New task");
  expect(host.textContent).toContain("Access revoked");
  await render(undefined, { recruitmentOnly: true });
  const calls = h.load.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(h.load).toHaveBeenCalledTimes(calls);
});
it("does not poll ordinary task pickers", async () => {
  vi.useFakeTimers();
  h.load.mockResolvedValue({ items: [item], nextCursor: null });
  await render("1");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("revalidates a loaded recruitment window atomically without overlapping requests", async () => {
  vi.useFakeTimers();
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "two", title: "Second" }], nextCursor: null });
  await render("1", { recruitmentOnly: true });
  await click(0);
  let finish!: (page: unknown) => void;
  h.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ items: [{ id: "three", title: "Third" }], nextCursor: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(h.load).toHaveBeenCalledTimes(3);
  expect(host.textContent).toContain("Second");
  await act(async () => finish({ items: [item], nextCursor: "new-next" }));
  expect(host.textContent).toContain("Third");
  expect(host.textContent).not.toContain("Second");
  expect(h.load.mock.calls[3][2]).toBe("new-next");
});
