import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryChapterProvider, useStoryChapterContext } from "./story-chapter-context";
const h = vi.hoisted(() => ({ publication: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));
vi.mock("@/hooks/app-active", () => ({
  isAppActive: () => true,
  subscribeAppActive: () => () => {},
}));
vi.mock("@/features/agent/api/interactive-film-publication-api", () => ({
  getInteractiveFilmPublication: h.publication,
}));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  storyProjectsApi: {
    getWorkbench: async () => ({
      chapter: { id: "chapter" },
      project: { capabilities: ["story.release"] },
    }),
    getBillingBalance: async () => null,
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
let state: ReturnType<typeof useStoryChapterContext>;
function Consumer() {
  const value = useStoryChapterContext();
  useLayoutEffect(() => {
    state = value;
  });
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  h.publication.mockReset();
  h.publication.mockResolvedValue(null);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
const render = () =>
  act(async () =>
    root.render(
      <StoryChapterProvider projectId="project">
        <Consumer />
      </StoryChapterProvider>
    )
  );
it("exposes the initial read error and explicitly retries it", async () => {
  h.publication.mockRejectedValueOnce(Error("Status offline"));
  await render();
  expect(state.publicationFailed).toBe(true);
  expect(state.publicationError).toBe("Status offline");
  await act(async () => state.refreshPublication());
  expect(h.publication).toHaveBeenCalledTimes(2);
  expect(state.publicationFailed).toBe(false);
  expect(state.publicationError).toBeUndefined();
});
it("preserves the last status but marks a failed background read unavailable", async () => {
  const published = { gameId: "project", status: "published", rejectReason: null };
  h.publication.mockResolvedValueOnce(published);
  await render();
  h.publication.mockRejectedValueOnce(Error("Polling offline"));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(state.publication).toEqual(published);
  expect(state.publicationFailed).toBe(true);
  expect(state.publicationError).toBe("Polling offline");
});
it("aborts superseded reads and ignores their late results", async () => {
  let finish!: (value: unknown) => void;
  h.publication.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.publication.mock.calls[0][1] as AbortSignal;
  await act(async () => state.refreshPublication());
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ gameId: "project", status: "published" }));
  expect(state.publication).toBeNull();
  expect(state.publicationFailed).toBe(false);
});
it("does not start overlapping poll requests", async () => {
  h.publication.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(90_000));
  expect(h.publication).toHaveBeenCalledTimes(1);
});
