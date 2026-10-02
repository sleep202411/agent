import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useNotifications } from "./use-notifications";
import type { NotificationFilter } from "./notification-api";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./notification-api", () => ({ fetchNotifications: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: NotificationFilter }) {
  const state = useNotifications(owner, role);
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.body}</span>
      ))}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: NotificationFilter = "all") =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", body: "First" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
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
    items: [item, { id: "two", body: "Second" }],
    nextCursor: null,
  });
  await render("1");
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1][1]).toBe("next");
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
  expect(h.load.mock.calls[2][1]).toBe("next");
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
  await render("2", "crew");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load.mock.calls[1].slice(0, 2)).toEqual(["crew", null]);
});
it("stops repeated cursors instead of looping forever", async () => {
  h.load.mockResolvedValue({ items: [item], nextCursor: "same" });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("did not advance");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});

it.each([401, 403])(
  "clears private previews on %s and explicitly restarts pagination",
  async (status) => {
    h.load
      .mockResolvedValueOnce({ items: [item], nextCursor: "next" })
      .mockRejectedValueOnce(Object.assign(new Error("Access denied"), { status }))
      .mockResolvedValueOnce({
        items: [{ ...item, body: "Revalidated" }],
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
    expect(h.load.mock.calls[2][1]).toBeNull();
    expect(host.textContent).toContain("Revalidated");
    expect(host.textContent).not.toContain("Access denied");
    await click(0);
    expect(h.load.mock.calls[3][1]).toBe("next");
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

it("revalidates all loaded pages without clearing rows mid-refresh", async () => {
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: "old" })
    .mockResolvedValueOnce({ items: [{ id: "two", body: "Second" }], nextCursor: null });
  await render("1");
  await click(0);
  let finish!: (value: unknown) => void;
  h.load
    .mockResolvedValueOnce({ items: [{ ...item, body: "Updated" }], nextCursor: "new" })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    );
  await act(async () => vi.advanceTimersByTime(60000));
  expect(host.textContent).toContain("FirstSecond");
  expect(h.load.mock.calls[3][1]).toBe("new");
  await act(async () =>
    finish({ items: [{ id: "two", body: "Current second" }], nextCursor: null })
  );
  expect(host.textContent).toContain("UpdatedCurrent second");
  expect(host.textContent).not.toContain("First");
  await render();
  await act(async () => vi.advanceTimersByTime(60000));
  expect(h.load).toHaveBeenCalledTimes(4);
});
it("retains rows on failed background refresh and retries from the first page even at the end", async () => {
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: null })
    .mockRejectedValueOnce(Error("Offline"))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render("1");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(host.textContent).toContain("FirstOffline");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][1]).toBeNull();
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).not.toContain("Offline");
});
it("clears revoked content during background refresh and rejects a late old scope", async () => {
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: null })
    .mockRejectedValueOnce(Object.assign(Error("Denied"), { status: 403 }));
  await render("1");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).toContain("Denied");
  let finish!: (value: unknown) => void;
  h.load
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await click(1);
  const signal = h.load.mock.calls[2][3];
  await render("2");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
});
