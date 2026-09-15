import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  id: "a",
  user: "one" as string | null,
  world: null as string | null,
  episode: null as string | null,
  post: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: s.id }),
  useSearchParams: () => ({ get: (key: string) => (key === "worldId" ? s.world : s.episode) }),
}));
vi.mock("./use-user", () => ({ useCurrentUser: () => ({ user: s.user ? { id: s.user } : null }) }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://example.test" } }));
vi.mock("@/src/store", async () => {
  const { configureStore } = await import("@reduxjs/toolkit");
  const { useSelector } = await import("react-redux");
  const { projectSlice } = await import("@/src/store/slices/projectSlice");
  return {
    store: configureStore({ reducer: { project: projectSlice.reducer } }),
    useAppSelector: useSelector,
  };
});
import { store } from "@/src/store";
import {
  selectCurrentInstance,
  setProjectId,
  setActiveEpisodeId,
  reset,
} from "@/src/store/slices/projectSlice";
import { useStoryboardData } from "./use-storyboard-data";
let root: Root;
const pending: {
  url: string;
  signal: AbortSignal;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}[] = [];
function View() {
  useStoryboardData();
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <View />
      </Provider>
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.id = "a";
  s.user = "one";
  s.world = null;
  s.episode = null;
  pending.length = 0;
  s.post
    .mockReset()
    .mockImplementation(
      (url, options) =>
        new Promise((resolve, reject) =>
          pending.push({ url, signal: options.signal, resolve, reject })
        )
    );
  store.dispatch(setProjectId("a"));
  store.dispatch(reset());
  store.dispatch(setActiveEpisodeId("world"));
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

it("rejects both delayed columns and rows after switching episode", async () => {
  await render();
  const old = [...pending];
  await act(async () => store.dispatch(setActiveEpisodeId("next")));
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  await act(async () => {
    for (const r of old)
      r.resolve(r.url.includes("shotColumn") ? [{ id: "old" }] : { list: [{ id: "old" }] });
  });
  expect(selectCurrentInstance(store.getState()).rows).toEqual([]);
  const current = pending.slice(2);
  await act(async () => {
    for (const r of current) r.resolve(r.url.includes("shotColumn") ? [] : { list: [] });
  });
  expect(selectCurrentInstance(store.getState()).isStoryboardLoading).toBe(false);
});
it("reloads an identical episode identifier for a different project", async () => {
  await render();
  const old = [...pending];
  await act(async () => {
    store.dispatch(setProjectId("b"));
    store.dispatch(reset());
    store.dispatch(setActiveEpisodeId("world"));
  });
  expect(pending).toHaveLength(4);
  expect(old.every((r) => r.signal.aborted)).toBe(true);
});
it("cancels on account change and unmount without applying late errors", async () => {
  await render();
  const old = [...pending];
  s.user = "two";
  await render();
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  await act(async () => root.render(null));
  expect(pending.every((r) => r.signal.aborted)).toBe(true);
  await act(async () => {
    for (const r of pending) r.reject(new Error("Late"));
  });
  expect(selectCurrentInstance(store.getState()).isStoryboardLoading).toBe(true);
});
