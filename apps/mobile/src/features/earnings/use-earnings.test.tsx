import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useEarnings } from "./use-earnings";

const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./api", () => ({ fetchEarnings: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: string }) {
  const state = useEarnings(owner, "en-US", role || "all", "all");
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.workTitle}</span>
      ))}
      {state.summary?.lifetimeEarned}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string, role: string = "") =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", workTitle: "First" };
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
  h.load
    .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "next" })
    .mockResolvedValueOnce({
      entries: [item, { id: "two", workTitle: "Second" }],
      nextCursor: null,
    });
  await render("1");
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1][3]).toBe("next");
  expect(host.textContent?.match(/First/g)).toHaveLength(1);
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("keeps loaded rows and retries the failed cursor explicitly", async () => {
  h.load
    .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "next" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ entries: [], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("offline");
  expect(host.textContent).toContain("First");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][3]).toBe("next");
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
    .mockResolvedValue({ entries: [], nextCursor: null });
  await render("1");
  const signal = h.load.mock.calls[0][4];
  await render("2", "crew");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ entries: [item], nextCursor: null }));
  expect(host.textContent).not.toContain("First");
  expect(h.load.mock.calls[1].slice(0, 4)).toEqual(["en-US", "crew", "all", null]);
});
it("stops repeated cursors instead of looping forever", async () => {
  h.load.mockResolvedValue({ entries: [item], nextCursor: "same" });
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
      .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "next" })
      .mockRejectedValueOnce(Object.assign(new Error("Access denied"), { status }))
      .mockResolvedValueOnce({
        entries: [{ ...item, workTitle: "Revalidated" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({ entries: [], nextCursor: null });
    await render("1");
    await click(0);
    expect(host.textContent).not.toContain("First");
    expect(host.textContent).not.toContain("987654321");
    expect(host.textContent).toContain("Access denied");
    await click(0);
    expect(h.load).toHaveBeenCalledTimes(2);
    await click(1);
    expect(h.load.mock.calls[2][3]).toBeNull();
    expect(host.textContent).toContain("Revalidated");
    expect(host.textContent).not.toContain("Access denied");
    await click(0);
    expect(h.load.mock.calls[3][3]).toBe("next");
  }
);

it("revalidates rows and totals when returning to a previously active screen", async () => {
  let finish!: (value: unknown) => void;
  h.load
    .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "next" })
    .mockImplementationOnce(
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
  expect(host.textContent).not.toContain("987654321");
  await act(async () => finish({ entries: [{ ...item, workTitle: "Fresh" }], nextCursor: null }));
  expect(host.textContent).toContain("Fresh");
});

it("restarts an expired cursor on Retry instead of repeatedly sending it", async () => {
  h.load
    .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "expired" })
    .mockRejectedValueOnce(Object.assign(new Error("Invalid earnings cursor"), { status: 400 }))
    .mockResolvedValueOnce({
      entries: [{ ...item, workTitle: "Fresh ledger" }],
      lifetimeEarned: "42",
      nextCursor: "fresh",
    })
    .mockResolvedValueOnce({ entries: [{ id: "two", workTitle: "Next entry" }], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("Invalid earnings cursor");
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).not.toContain("987654321");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][3]).toBeNull();
  expect(host.textContent).toContain("Fresh ledger");
  expect(host.textContent).not.toContain("Invalid earnings cursor");
  await click(0);
  expect(h.load.mock.calls[3][3]).toBe("fresh");
  expect(host.textContent).toContain("Next entry");
});
it("does not discard loaded earnings for unrelated validation errors", async () => {
  h.load
    .mockResolvedValueOnce({ entries: [item], lifetimeEarned: "987654321", nextCursor: "next" })
    .mockRejectedValueOnce(Object.assign(new Error("Invalid filter"), { status: 400 }))
    .mockResolvedValueOnce({ entries: [], nextCursor: null });
  await render("1");
  await click(0);
  expect(host.textContent).toContain("First");
  expect(host.textContent).toContain("Invalid filter");
  await click(1);
  expect(h.load.mock.calls[2][3]).toBe("next");
});
