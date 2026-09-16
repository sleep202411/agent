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
import { selectCurrentInstance, setProjectId, setDetail } from "@/src/store/slices/projectSlice";
import { useProjectDetail } from "./use-project-detail";
let root: Root;
const pending: {
  url: string;
  signal: AbortSignal;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}[] = [];
function View() {
  useProjectDetail();
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
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("aborts old project reads and prevents late detail and episodes overwriting the replacement", async () => {
  await render();
  const old = [...pending];
  s.id = "b";
  await render();
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  await act(async () => {
    for (const r of old)
      r.resolve(r.url.includes("detail") ? { id: "a", worldId: "old" } : { list: [{ id: "old" }] });
  });
  expect(selectCurrentInstance(store.getState()).detail).toBeNull();
  expect(selectCurrentInstance(store.getState()).episodes).toEqual([]);
  expect(store.getState().project.currentProjectId).toBe("b");
});
it("cancels world reads and suppresses late failures after departure", async () => {
  s.world = "world-a";
  await render();
  const old = [...pending];
  await act(async () => root.render(null));
  expect(old.every((r) => r.signal.aborted)).toBe(true);
  await act(async () => {
    for (const r of old) r.reject(new Error("Late"));
  });
  expect(selectCurrentInstance(store.getState()).error).toBeNull();
});
it("reloads the same project for a replacement account and clears its prior detail", async () => {
  await render();
  await act(async () =>
    pending.find((r) => r.url.includes("detail"))!.resolve({ id: "a", name: "Private" })
  );
  expect(selectCurrentInstance(store.getState()).detail?.name).toBe("Private");
  s.user = "two";
  await render();
  expect(selectCurrentInstance(store.getState()).detail).toBeNull();
  expect(pending.filter((r) => r.url.includes("detail"))).toHaveLength(2);
});
it("does not reset the outgoing project when entering another project", async () => {
  await render();
  await act(async () =>
    pending.find((r) => r.url.includes("detail"))!.resolve({ id: "a", name: "Keep" })
  );
  s.id = "b";
  await render();
  expect(store.getState().project.instances.a.detail?.name).toBe("Keep");
});
it("rejects late results when another caller selects a different current project", async () => {
  await render();
  const old = [...pending];
  await act(async () => {
    store.dispatch(setProjectId("elsewhere"));
    store.dispatch(
      setDetail({ id: "elsewhere", name: "Current" } as Parameters<typeof setDetail>[0])
    );
  });
  await act(async () => {
    for (const r of old) r.resolve({ id: "a", list: [] });
  });
  expect(selectCurrentInstance(store.getState()).detail?.name).toBe("Current");
});

it("preserves URL episode selection after loading the destination project", async () => {
  s.world = "world&part=2";
  s.episode = "second";
  await render();
  await act(async () => {
    pending.find((r) => r.url.includes("project/detail"))!.resolve({ id: "a" });
    pending
      .find((r) => r.url.includes("list/episode"))!
      .resolve({
        list: [{ id: "first" }, { id: "second" }],
      });
  });
  expect(selectCurrentInstance(store.getState()).activeEpisodeId).toBe("second");
  const world = pending.filter((r) => r.url.includes("query/world") && !r.signal.aborted);
  expect(world.length).toBeGreaterThan(0);
  expect(world.at(-1)!.url).toBe("/api/user/world/query/world?id=world%26part%3D2");
  await act(async () => world.at(-1)!.resolve(null));
  expect(selectCurrentInstance(store.getState()).isWorldLoading).toBe(false);
});
