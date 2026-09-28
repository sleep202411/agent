import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ShotRow } from "@/src/store/slices/projectSlice";
const s = vi.hoisted(() => ({
  project: "p",
  detail: { id: "p" },
  episode: "e",
  rows: [] as ShotRow[],
  post: vi.fn(),
  dispatch: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://assets.invalid" } }));
vi.mock("sonner", () => ({ toast: { error: s.error } }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator", () => ({
  AiImageGeneratorDialog: () => null,
  AiVideoGeneratorDialog: () => null,
}));
vi.mock("./storyboard-dialog-context", () => ({ useStoryboardDialog: () => ({}) }));
vi.mock("@/src/store", () => ({
  store: { getState: () => ({ project: { currentProjectId: s.project } }), dispatch: s.dispatch },
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ project: { currentProjectId: s.project } }),
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  selectCurrentInstance: () => ({ rows: s.rows, detail: s.detail, activeEpisodeId: s.episode }),
  setRows: (rows: ShotRow[]) => ({ type: "rows", payload: rows }),
}));
import { useCellCallbacks } from "./storyboard-lifted-dialogs";
let root: Root;
let callbacks: ReturnType<typeof useCellCallbacks>;
const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
function View() {
  const value = useCellCallbacks("shot", "column");
  useLayoutEffect(() => {
    callbacks = value;
  });
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.project = "p";
  s.detail = { id: "p" };
  s.episode = "e";
  s.rows = [{ shotId: "shot", shotValues: [{ shotColumnId: "column", id: "cell", files: [] }] }];
  pending.length = 0;
  s.error.mockReset();
  s.dispatch.mockReset().mockImplementation((action) => {
    s.rows = action.payload;
  });
  s.post
    .mockReset()
    .mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<View />));
});
afterEach(() => act(() => root.unmount()));
it("keeps rapid collections and rejects older acknowledgements", async () => {
  callbacks.handleCollect({ id: "a", storagePath: "a" });
  callbacks.handleCollect({ id: "b", storagePath: "b" });
  expect(s.post.mock.calls[1][1].data.values).toEqual(["a", "b"]);
  await act(async () => pending[1].resolve("new-cell"));
  await act(async () => pending[0].resolve("old-cell"));
  expect(s.rows[0].shotValues![0]).toMatchObject({ id: "new-cell", values: ["a", "b"] });
});
it("ignores a collection acknowledgement after project replacement", async () => {
  const work = callbacks.persistPaths(["a"]);
  s.project = "q";
  s.dispatch.mockClear();
  pending[0].resolve("old-cell");
  await work;
  expect(s.dispatch).not.toHaveBeenCalled();
});
it("does not start preference after departure during its prerequisite save", async () => {
  const work = callbacks.handleSetPreferred({ path: "a" });
  s.episode = "other";
  pending[0].resolve("cell");
  await work;
  expect(s.post).toHaveBeenCalledTimes(1);
});
it("stops preference after failed save and retries the prerequisite", async () => {
  const work = callbacks.handleSetPreferred({ path: "a" });
  pending[0].reject(new Error("offline"));
  await work;
  expect(s.post).toHaveBeenCalledTimes(1);
  expect(s.error).toHaveBeenCalledTimes(1);
  const retry = callbacks.handleSetPreferred({ path: "a" });
  expect(s.post.mock.calls[1][0]).toBe("/api/user/shotValue/input");
  await act(async () => pending[1].resolve("cell"));
  expect(s.post).toHaveBeenCalledTimes(3);
  pending[2].resolve({});
  await retry;
  expect(s.rows[0].shotValues![0].files).toEqual([{ path: "a", preferred: true }]);
});
it("handles a preference failure without an unhandled rejection", async () => {
  const work = callbacks.handleSetPreferred({ path: "a" });
  await act(async () => pending[0].resolve("cell"));
  pending[1].reject(new Error("offline"));
  await expect(work).resolves.toBeUndefined();
  expect(s.error).toHaveBeenCalledTimes(1);
});
it("rejects retained actions after unmount", async () => {
  await act(async () => root.unmount());
  callbacks.handleCollect({ id: "a", storagePath: "a" });
  await callbacks.handleSetPreferred({ path: "a" });
  expect(s.post).not.toHaveBeenCalled();
  expect(s.dispatch).not.toHaveBeenCalled();
});
