import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskCenter } from "./use-task-center";

const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./task-center-api", () => ({ fetchTaskCenter: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: string }) {
  const filters = useMemo(
    () => ({
      scope: "mine" as const,
      status: "active" as const,
      crewId: role,
      taskKind: "" as const,
      query: "",
    }),
    [role]
  );
  const state = useTaskCenter(!!owner, Number(owner ?? 1), filters);
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.title}</span>
      ))}
      {state.summary?.stats?.dueSoon}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: string = "") =>
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
  h.load
    .mockResolvedValueOnce({
      items: [item],
      stats: { dueSoon: 987654321, pendingReviews: 0 },
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      items: [item, { id: "two", title: "Second" }],
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
    .mockResolvedValueOnce({
      items: [item],
      stats: { dueSoon: 987654321, pendingReviews: 0 },
      nextCursor: "next",
    })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("offline");
  expect(host.textContent).toContain("First");
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
  expect(h.load.mock.calls[1][0].crewId).toBe("crew");
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
      .mockResolvedValueOnce({
        items: [item],
        stats: { dueSoon: 987654321, pendingReviews: 0 },
        nextCursor: "next",
      })
      .mockRejectedValueOnce(Object.assign(new Error("Access denied"), { status }))
      .mockResolvedValueOnce({
        items: [{ ...item, title: "Revalidated" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await render("1");
    await click(0);
    expect(host.textContent).not.toContain("First");
    expect(host.textContent).not.toContain("987654321");
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

it("polls loaded pages atomically and stops while inactive", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: "page2" })
    .mockResolvedValueOnce({ items: [{ id: "two", title: "Second" }], nextCursor: null })
    .mockResolvedValueOnce({ items: [{ ...item, title: "Updated" }], nextCursor: "new-page2" })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  await render("1");
  await click(0);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(h.load.mock.calls[2][1]).toBeNull();
  expect(h.load.mock.calls[3][1]).toBe("new-page2");
  expect(host.textContent).toContain("FirstSecond");
  expect(host.textContent).not.toContain("Updated");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(h.load).toHaveBeenCalledTimes(4);
  await act(async () => finish({ items: [{ id: "three", title: "Third" }], nextCursor: null }));
  expect(host.textContent).toContain("UpdatedThird");
  expect(host.textContent).not.toContain("Second");
  await render();
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(h.load).toHaveBeenCalledTimes(4);
});
it("retries a failed poll from the first page even at the end of the list", async () => {
  vi.useFakeTimers();
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: null })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [{ ...item, title: "Recovered" }], nextCursor: null });
  await render("1");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(host.textContent).toContain("Firstoffline");
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][1]).toBeNull();
  expect(host.textContent).toContain("Recovered");
  expect(host.textContent).not.toContain("offline");
});
it("ignores a late poll after switching accounts", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  h.load
    .mockResolvedValueOnce({ items: [item], nextCursor: null })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render("1");
  await act(async () => vi.advanceTimersByTime(60_000));
  const signal = h.load.mock.calls[1][3];
  await render("2");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
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
