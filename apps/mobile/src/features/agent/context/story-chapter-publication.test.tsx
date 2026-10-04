import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryChapterProvider, useStoryChapterContext } from "./story-chapter-context";
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
const h = vi.hoisted(() => ({
  publication: vi.fn(),
  workbench: vi.fn(),
  params: {} as Record<string, string>,
}));
vi.mock("expo-router", () => ({ useGlobalSearchParams: () => h.params }));
vi.mock("@/hooks/app-active", () => ({
  isAppActive: () => true,
  subscribeAppActive: () => () => {},
}));
vi.mock("@/features/agent/api/interactive-film-publication-api", () => ({
  getInteractiveFilmPublication: h.publication,
}));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  storyProjectsApi: {
    getWorkbench: h.workbench,
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
  h.params = {};
  h.workbench.mockReset().mockResolvedValue({
    chapter: { id: "chapter" },
    project: { capabilities: ["story.read", "story.release"] },
  });
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

it("uses the focused child chapter and ignores another project's route", async () => {
  const selected = "00000000-0000-4000-8000-000000000005";
  const next = "00000000-0000-4000-8000-000000000006";
  h.params = { projectId: "project", chapterId: selected };
  h.workbench.mockImplementation(async () => ({
    project: { capabilities: ["story.edit"] },
    chapter: { id: "default" },
    chapters: [{ id: selected }, { id: next }],
  }));
  await render();
  expect(state.chapterId).toBe(selected);
  expect(h.workbench).toHaveBeenLastCalledWith("project", selected);
  h.params = { projectId: "another", chapterId: next };
  await render();
  expect(state.chapterId).toBe(selected);
  expect(h.workbench).toHaveBeenCalledTimes(1);
  h.params = { projectId: "project", chapterId: next };
  await render();
  expect(state.chapterId).toBe(next);
  expect(h.workbench).toHaveBeenLastCalledWith("project", next);
});

it("does not substitute another chapter when the selected chapter disappears", async () => {
  const selected = "00000000-0000-4000-8000-000000000005";
  h.params = { projectId: "project", chapterId: selected };
  h.workbench.mockResolvedValue({
    project: { capabilities: ["story.edit"] },
    chapter: { id: "default" },
    chapters: [{ id: "default" }],
  });
  await render();
  expect(state.chapterId).toBe("");
  expect(state.capabilities).toEqual([]);
  expect(state.error).toBe("agent.chapterUnavailable");
  expect(state.requestedChapterId).toBe(selected);
  h.workbench.mockResolvedValue({
    project: { capabilities: ["story.read"] },
    chapter: { id: selected },
    chapters: [{ id: selected }],
  });
  await act(async () => state.refresh());
  expect(h.workbench).toHaveBeenLastCalledWith("project", selected);
  expect(state.chapterId).toBe(selected);
  expect(state.capabilities).toEqual(["story.read"]);
  expect(state.error).toBeUndefined();
});

it("loads publication status for readers without granting release actions", async () => {
  h.workbench.mockResolvedValue({
    chapter: { id: "chapter" },
    project: { capabilities: ["story.read"] },
  });
  h.publication.mockResolvedValue({ gameId: "project", status: "published", rejectReason: null });
  await render();
  expect(h.publication).toHaveBeenCalledOnce();
  expect(state.publication?.status).toBe("published");
  expect(state.capabilities).not.toContain("story.release");
});

it("exposes the workbench version and clears it when a refresh lacks a valid version", async () => {
  h.workbench.mockResolvedValueOnce({
    chapter: { id: "chapter" },
    project: { projectVersion: 12, capabilities: ["story.read"] },
  });
  await render();
  expect(state.projectVersion).toBe(12);
  await act(async () => state.refresh());
  expect(state.projectVersion).toBeNull();
});
