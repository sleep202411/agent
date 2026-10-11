import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWithdrawals } from "./use-withdrawals";
const h = vi.hoisted(() => ({ balances: vi.fn(), history: vi.fn() }));
vi.mock("./withdrawal-api", () => ({
  fetchWithdrawalBalances: h.balances,
  fetchWithdrawalHistory: h.history,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ active = true, generation = 1 }: { active?: boolean; generation?: number }) {
  const feed = useWithdrawals(generation, active);
  return (
    <div>
      {feed.items.map((row) => (
        <span key={row.id}>
          {row.id}:{row.status}
        </span>
      ))}
      {feed.balances?.[0]?.availableAmountMinor}
      {feed.balanceError}
      {feed.historyError}
      <button onClick={feed.loadMore}>more</button>
      <button onClick={feed.refresh}>refresh</button>
    </div>
  );
}
const render = (active = true, generation = 1) =>
  act(async () => root.render(<Probe active={active} generation={generation} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  h.balances.mockResolvedValue([{ currency: "USD", availableAmountMinor: "10000" }]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("retains previous pages during next-page errors and retries the same cursor without duplicates", async () => {
  h.history
    .mockResolvedValueOnce({ items: [{ id: "first", status: "pending" }], nextCursor: "next" })
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce({
      items: [
        { id: "first", status: "paid" },
        { id: "second", status: "pending" },
      ],
      nextCursor: null,
    });
  await render();
  await click(0);
  expect(host.textContent).toContain("first:pending");
  expect(host.textContent).toContain("offline");
  await click(0);
  expect(h.history.mock.calls[2][1]).toBe("next");
  expect(host.textContent).toContain("first:paid");
  expect(host.textContent?.match(/first:/g)).toHaveLength(1);
});
it("retires private snapshots across background return and account changes", async () => {
  h.history.mockResolvedValue({ items: [{ id: "old", status: "paid" }], nextCursor: null });
  await render();
  await render(false);
  expect(host.textContent).not.toContain("old");
  let finish!: (value: unknown) => void;
  h.history.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  expect(host.textContent).not.toContain("old");
  const signal = h.history.mock.calls[1][2] as AbortSignal;
  h.history.mockResolvedValue({ items: [{ id: "new", status: "pending" }], nextCursor: null });
  await render(true, 2);
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [{ id: "old", status: "paid" }], nextCursor: null }));
  expect(host.textContent).not.toContain("old");
  expect(host.textContent).toContain("new");
});
it("refreshes all loaded pages and removes stale statuses after refresh failures", async () => {
  vi.useFakeTimers();
  h.history
    .mockResolvedValueOnce({ items: [{ id: "first", status: "pending" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "second", status: "pending" }], nextCursor: null })
    .mockResolvedValueOnce({ items: [{ id: "first", status: "paid" }], nextCursor: "next" })
    .mockRejectedValueOnce(Error("refresh failed"))
    .mockResolvedValueOnce({ items: [{ id: "first", status: "paid" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "second", status: "paid" }], nextCursor: null });
  await render();
  await click(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(host.textContent).not.toContain("first:");
  expect(host.textContent).toContain("refresh failed");
  await click(0);
  expect(h.history.mock.calls.slice(4).map((call) => call[1])).toEqual([null, "next"]);
  expect(host.textContent).toContain("second:paid");
});
it("keeps history usable when balance lookup fails and rejects cursor cycles", async () => {
  h.balances.mockRejectedValue(Error("balance offline"));
  h.history.mockResolvedValue({ items: [{ id: "first", status: "pending" }], nextCursor: "same" });
  await render();
  expect(host.textContent).toContain("first:pending");
  expect(host.textContent).toContain("balance offline");
  await click(0);
  expect(host.textContent).toContain("did not advance");
});
it.each([401, 403, 400])(
  "clears private history and resets pagination on status %s",
  async (status) => {
    h.history
      .mockResolvedValueOnce({ items: [{ id: "first", status: "pending" }], nextCursor: "next" })
      .mockRejectedValueOnce(Object.assign(Error("Invalid withdrawal history cursor."), { status }))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await render();
    await click(0);
    expect(host.textContent).not.toContain("first:");
    await click(0);
    expect(h.history.mock.calls[2][1]).toBeNull();
  }
);
