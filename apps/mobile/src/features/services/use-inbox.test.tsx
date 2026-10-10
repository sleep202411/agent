import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useInbox } from "./use-inbox";
import type { InboxFilter } from "./inbox-api";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./inbox-api", () => ({ fetchInbox: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, role }: { owner?: string; role: InboxFilter }) {
  const state = useInbox(owner, role);
  return (
    <div>
      {state.items.map((i) => (
        <span key={i.id}>{i.lastMessagePreview}</span>
      ))}
      {state.error}
      {state.loading && <em>Loading</em>}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
      <button onClick={state.loadMoreOnScroll}>scroll</button>
    </div>
  );
}
const render = (owner?: string, role: InboxFilter = "") =>
  act(async () => root.render(<Probe owner={owner} role={role} />));
const click = (n: number) => act(async () => host.querySelectorAll("button")[n]!.click());
const item = { id: "one", lastMessagePreview: "First" };
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
    items: [item, { id: "two", lastMessagePreview: "Second" }],
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
  const signal = h.load.mock.calls[0][2];
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
        items: [{ ...item, lastMessagePreview: "Revalidated" }],
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

it("walks empty cursor pages until a visible conversation is found", async () => {
  h.load
    .mockResolvedValueOnce({ items: [], nextCursor: "a" })
    .mockResolvedValueOnce({ items: [], nextCursor: "b" })
    .mockResolvedValueOnce({ items: [item], nextCursor: null });
  await render("1", "crew");
  expect(h.load.mock.calls.map((call) => call[1])).toEqual([null, "a", "b"]);
  expect(host.textContent).toContain("First");
});
it("caps automatic empty-page traversal but allows explicit continuation", async () => {
  let page = 0;
  h.load.mockImplementation(async () => ({ items: [], nextCursor: String(++page) }));
  await render("1");
  expect(h.load).toHaveBeenCalledTimes(9);
  await click(2);
  expect(h.load).toHaveBeenCalledTimes(9);
  h.load.mockResolvedValueOnce({ items: [item], nextCursor: null });
  await click(0);
  expect(h.load.mock.calls[9][1]).toBe("9");
  expect(host.textContent).toContain("First");
});
it("retries the interrupted empty-page cursor without replaying earlier pages", async () => {
  h.load
    .mockResolvedValueOnce({ items: [], nextCursor: "next" })
    .mockRejectedValueOnce(Error("Offline"))
    .mockResolvedValueOnce({ items: [item], nextCursor: null });
  await render("1");
  expect(host.textContent).toContain("Offline");
  await click(2);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][1]).toBe("next");
  expect(host.textContent).toContain("First");
});
