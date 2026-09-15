import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  state: {
    project: { currentProjectId: "p" },
    instance: {
      detail: { id: "p" },
      activeEpisodeId: "one",
      episodes: [
        { id: "one", frontPrompt: "", behindPrompt: "" },
        { id: "two", frontPrompt: "", behindPrompt: "" },
      ],
    },
  },
  listeners: new Set<() => void>(),
  post: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/src/store", () => ({
  store: {
    getState: () => s.state,
    dispatch: s.dispatch,
    subscribe: (listener: () => void) => {
      s.listeners.add(listener);
      return () => s.listeners.delete(listener);
    },
  },
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  selectCurrentInstance: (state: typeof s.state) => state.instance,
  setEpisodes: (episodes: unknown) => ({ type: "episodes", payload: episodes }),
}));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
import { useEpisodePromptAutosave } from "./use-episode-prompt-autosave";
let root: Root;
let autosave: ReturnType<typeof useEpisodePromptAutosave>;
function View() {
  const value = useEpisodePromptAutosave();
  useLayoutEffect(() => {
    autosave = value;
  });
  return null;
}
function notify() {
  s.listeners.forEach((listener) => listener());
}
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.state.project.currentProjectId = "p";
  s.state.instance.detail.id = "p";
  s.state.instance.activeEpisodeId = "one";
  s.state.instance.episodes = [
    { id: "one", frontPrompt: "", behindPrompt: "" },
    { id: "two", frontPrompt: "", behindPrompt: "" },
  ];
  s.post.mockReset().mockResolvedValue({});
  s.dispatch.mockReset();
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<View />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("debounces the pair and releases the timer after saving the captured episode", async () => {
  autosave.schedule("old", "old");
  autosave.schedule(" new ", " tail ");
  expect(autosave.isPending()).toBe(true);
  await act(async () => vi.advanceTimersByTime(500));
  expect(s.post).toHaveBeenCalledExactlyOnceWith("/api/user/world/update/episode", {
    data: { id: "one", projectId: "p", frontPrompt: "new", behindPrompt: "tail" },
  });
  expect(autosave.isPending()).toBe(false);
  expect(s.dispatch.mock.calls[0][0].payload[1].frontPrompt).toBe("");
});
it("cancels on episode departure even if the viewer returns before the timer fires", async () => {
  autosave.schedule("old", "old");
  s.state.instance.activeEpisodeId = "two";
  notify();
  s.state.instance.activeEpisodeId = "one";
  notify();
  await act(async () => vi.advanceTimersByTime(500));
  expect(s.post).not.toHaveBeenCalled();
  expect(autosave.isPending()).toBe(false);
});
it("rejects a project replacement and allows a new edit without reusing the old timer", async () => {
  autosave.schedule("old", "old");
  s.state.project.currentProjectId = "q";
  s.state.instance.detail.id = "q";
  notify();
  autosave.schedule("replacement", "");
  await act(async () => vi.advanceTimersByTime(500));
  expect(s.post).toHaveBeenCalledTimes(1);
  expect(s.post.mock.calls[0][1].data.frontPrompt).toBe("replacement");
});
it("does not recreate a deleted episode", async () => {
  autosave.schedule("old", "old");
  s.state.instance.episodes = [];
  notify();
  await act(async () => vi.advanceTimersByTime(500));
  expect(s.dispatch).not.toHaveBeenCalled();
  expect(s.post).not.toHaveBeenCalled();
});
it("flushes on normal close once and rejects retained actions after unmount", async () => {
  autosave.schedule("last edit", "");
  await act(async () => root.unmount());
  expect(s.post).toHaveBeenCalledTimes(1);
  autosave.schedule("late", "");
  await act(async () => vi.advanceTimersByTime(500));
  expect(s.post).toHaveBeenCalledTimes(1);
});
