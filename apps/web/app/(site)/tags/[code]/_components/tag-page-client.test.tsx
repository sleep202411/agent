import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TagPageClient } from "./tag-page-client";
const s = vi.hoisted(() => ({
  loading: false,
  error: false,
  fetching: false,
  hasNext: true,
  next: vi.fn(),
  items: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useInfiniteIpsByTag: () => ({
    data: { pages: [{ items: s.items, total: 50, term: { label: "Competition" } }] },
    isLoading: s.loading,
    isError: s.error,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: s.next,
    hasNextPage: s.hasNext,
    isFetchingNextPage: s.fetching,
  }),
}));
vi.mock("@/app/(site)/ips/_components/ip-plaza-card", () => ({
  IPPlazaCard: ({ project }: { project: { name: string } }) => <article>{project.name}</article>,
}));
let root: Root;
let node: HTMLDivElement;
const observers: Array<{ target: Element | null; disconnected: boolean; intersect: () => void }> =
  [];
async function renderPage() {
  await act(async () => root.render(<TagPageClient code="competition" />));
}
async function search(value: string) {
  const input = node.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(300));
}
function liveObserver() {
  return observers.findLast((o) => !o.disconnected && o.target?.isConnected);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  s.loading = false;
  s.error = false;
  s.fetching = false;
  s.hasNext = true;
  s.next.mockReset();
  s.items = [{ id: "one", title: "First entry", genres: [], tags: [], episodes: [] }];
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      record: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.record = {
          target: null,
          disconnected: false,
          intersect: () =>
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            ),
        };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.disconnected = true;
      }
    }
  );
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("keeps loading later pages when a search has no matches yet", async () => {
  await renderPage();
  await search("Later entry");
  expect(node.querySelectorAll("article")).toHaveLength(0);
  expect(liveObserver()).toBeDefined();
  act(() => liveObserver()!.intersect());
  expect(s.next).toHaveBeenCalledTimes(1);
  s.items.push({ id: "two", title: "Later entry", genres: [], tags: [], episodes: [] });
  await renderPage();
  expect(node.querySelector("article")?.textContent).toBe("Later entry");
});
it("keeps a connected trigger after clearing a no-match search", async () => {
  await renderPage();
  await search("No match");
  await search("");
  expect(liveObserver()).toBeDefined();
  act(() => liveObserver()!.intersect());
  expect(s.next).toHaveBeenCalledTimes(1);
});
it("reconnects after an error screen recovers with the same next-page state", async () => {
  await renderPage();
  s.error = true;
  await renderPage();
  s.error = false;
  await renderPage();
  expect(liveObserver()).toBeDefined();
  act(() => liveObserver()!.intersect());
  expect(s.next).toHaveBeenCalledTimes(1);
});
it("disconnects when all pages are loaded and on unmount", async () => {
  await renderPage();
  s.hasNext = false;
  await renderPage();
  expect(liveObserver()).toBeUndefined();
  s.hasNext = true;
  await renderPage();
  act(() => root.render(null));
  expect(liveObserver()).toBeUndefined();
});
