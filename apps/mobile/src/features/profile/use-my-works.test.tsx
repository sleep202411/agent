import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { refreshPersonalWorks } from "./work-refresh";
import { useMyWorks } from "./use-my-works";
const h = vi.hoisted(() => ({ load: vi.fn(), active: true, t: (key: string) => key }));
vi.mock("@/data/mine-api", () => ({ fetchMyWorksPage: h.load }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const work = { id: "1", title: "First", isPrivate: false };
function Probe({ owner }: { owner?: string }) {
  const state = useMyWorks(owner);
  return (
    <div>
      {state.works?.map((w) => (
        <span key={w.id}>{w.title}</span>
      ))}
      {state.loading && "loading"}
      {state.failed && "failed"}
      {state.error}
      <button onClick={state.loadMore}>more</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (owner?: string) => act(async () => root.render(<Probe owner={owner} />));
const click = (index: number) => act(async () => host.querySelectorAll("button")[index]!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not load for guests and stops at the final page", async () => {
  await render();
  expect(h.load).not.toHaveBeenCalled();
  h.load.mockResolvedValue({ works: [work], hasMore: false });
  await render("alice:1");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("First");
});
it("loads later pages once on rapid end events and deduplicates repeated rows", async () => {
  h.load.mockResolvedValueOnce({ works: [work], hasMore: true }).mockResolvedValueOnce({
    works: [work, { ...work, id: "2", title: "Second" }],
    hasMore: false,
  });
  await render("alice:1");
  await act(async () => {
    const b = host.querySelector("button")!;
    b.click();
    b.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1][0]).toBe(2);
  expect(host.textContent?.match(/First/g)).toHaveLength(1);
  expect(host.textContent).toContain("Second");
});
it("keeps existing items on failure and retries the same page only on explicit request", async () => {
  h.load
    .mockResolvedValueOnce({ works: [work], hasMore: true })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ works: [], hasMore: false });
  await render("alice:1");
  await click(0);
  expect(host.textContent).toContain("Firstfailed");
  await click(0);
  expect(h.load).toHaveBeenCalledTimes(2);
  await click(1);
  expect(h.load.mock.calls[2][0]).toBe(2);
  expect(host.textContent).not.toContain("failed");
});
it("aborts an old account and ignores its delayed page", async () => {
  let finish!: (value: unknown) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce({ works: [{ ...work, title: "Bob" }], hasMore: false });
  await render("alice:1");
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  await render("bob:2");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ works: [work], hasMore: false }));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).not.toContain("First");
  await render();
  expect(host.textContent).not.toContain("Bob");
});

it("refreshes the first page after a publishing mutation", async () => {
  h.load.mockResolvedValueOnce({ works: [work], hasMore: false }).mockResolvedValueOnce({
    works: [{ ...work, id: "new", title: "Uploaded" }, work],
    hasMore: false,
  });
  await render("alice:1");
  await act(async () => refreshPersonalWorks());
  expect(h.load.mock.calls[1][0]).toBe(1);
  expect(host.textContent).toContain("Uploaded");
});

it("aborts background reads and reloads changed works on return", async () => {
  h.load
    .mockResolvedValueOnce({ works: [work], hasMore: false })
    .mockResolvedValueOnce({ works: [{ ...work, title: "Updated" }], hasMore: false });
  await render("alice");
  const signal = h.load.mock.calls[0][1];
  h.active = false;
  await render("alice");
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("First");
  h.active = true;
  await render("alice");
  expect(host.textContent).toContain("Updated");
  expect(h.load.mock.calls[1][0]).toBe(1);
});
it("hides invalidated rows immediately while a publishing refresh is pending", async () => {
  h.load
    .mockResolvedValueOnce({ works: [work], hasMore: false })
    .mockReturnValueOnce(new Promise(() => {}));
  await render("alice");
  await act(async () => refreshPersonalWorks());
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).toContain("loading");
});
it("preserves actionable errors and restarts from page one after lost access", async () => {
  h.load
    .mockResolvedValueOnce({ works: [work], hasMore: true })
    .mockRejectedValueOnce(Object.assign(new Error("Access withdrawn"), { status: 403 }))
    .mockResolvedValueOnce({ works: [], hasMore: false });
  await render("alice");
  await click(0);
  expect(host.textContent).toContain("Access withdrawn");
  expect(host.textContent).not.toContain("First");
  await click(1);
  expect(h.load.mock.calls[2][0]).toBe(1);
});
