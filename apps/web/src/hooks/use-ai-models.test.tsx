import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  project: "p",
  cache: {} as Record<string, unknown[]>,
  raw: {} as Record<string, unknown[]>,
  loading: false,
  post: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/src/store", () => {
  const getState = () => ({
    project: { currentProjectId: s.project },
    aiModelCache: { aiModelCache: s.cache, aiRawModelCache: s.raw, aiModelCacheLoading: s.loading },
  });
  return {
    store: { getState, dispatch: s.dispatch },
    useAppSelector: (selector: (state: unknown) => unknown) => selector(getState()),
  };
});
vi.mock("@/src/store/slices/aiModelCacheSlice", () => ({
  setAiModelCache: (payload: unknown) => ({ type: "models", payload }),
  setAiRawModelCache: (payload: unknown) => ({ type: "raw", payload }),
  setAiModelCacheLoading: (payload: unknown) => ({ type: "loading", payload }),
}));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/components/ui/schema-field/schema", () => ({
  normalizeAiModel: (value: unknown) => value,
}));
vi.mock("@/components/ui/schema-field/paths", () => ({ ALL_AI_MODEL_PATHS: ["/one", "/two"] }));
import { useAiModelsPreload, useEnsureAiModels } from "./use-ai-models";
let root: Root;
const pending: {
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}[] = [];
function Preload() {
  useAiModelsPreload();
  return null;
}
function Ensure() {
  useEnsureAiModels("/one");
  return null;
}
async function render(strict = false) {
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <Preload />
        </StrictMode>
      ) : (
        <Preload />
      )
    )
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.project = "p";
  s.cache = {};
  s.raw = {};
  s.loading = false;
  pending.length = 0;
  s.post
    .mockReset()
    .mockImplementation(
      (_url, options) =>
        new Promise((resolve, reject) => pending.push({ signal: options?.signal, resolve, reject }))
    );
  s.dispatch.mockReset().mockImplementation((action) => {
    if (action.type === "models") s.cache[action.payload.path] = action.payload.models;
    if (action.type === "raw") s.raw[action.payload.path] = action.payload.models;
    if (action.type === "loading") s.loading = action.payload;
  });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("fills missing paths even when one catalog is already cached", async () => {
  s.cache["/one"] = [{ id: "existing" }];
  await render();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(s.post).toHaveBeenCalledTimes(1);
  expect(s.post.mock.calls[0][0]).toContain("%2Ftwo");
  await act(async () => pending[0].resolve([]));
  expect(s.cache["/one"]).toEqual([{ id: "existing" }]);
  expect(s.cache["/two"]).toEqual([]);
});
it("cancels deferred admission when the page leaves before idle", async () => {
  await render();
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(s.post).not.toHaveBeenCalled();
  expect(s.loading).toBe(false);
});
it("does not duplicate idle batches in Strict Mode", async () => {
  await render(true);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(s.post).toHaveBeenCalledTimes(2);
});
it("abandons old results without clearing a replacement batch's loading state", async () => {
  await render();
  await act(async () => vi.advanceTimersByTime(1000));
  s.project = "q";
  await render();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(s.post).toHaveBeenCalledTimes(4);
  expect(pending[0].signal?.aborted).toBe(true);
  await act(async () => {
    pending[0].resolve([{ id: "old" }]);
    pending[1].resolve([]);
  });
  expect(s.cache).toEqual({});
  expect(s.loading).toBe(true);
  await act(async () => {
    pending[2].resolve([]);
    pending[3].resolve([]);
  });
  expect(s.loading).toBe(false);
});
it("does not poison either cache with a malformed successful response", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await render();
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => {
    pending[0].resolve({ invalid: true });
    pending[1].resolve([]);
  });
  expect(s.cache["/one"]).toBeUndefined();
  expect(s.raw["/one"]).toBeUndefined();
  expect(s.loading).toBe(false);
});
it("aborts a targeted read and preserves an explicitly empty cached catalog", async () => {
  await act(async () => root.render(<Ensure />));
  expect(s.post).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  expect(pending[0].signal?.aborted).toBe(true);
  await act(async () => pending[0].resolve([{ id: "old" }]));
  expect(s.cache).toEqual({});
  s.cache["/one"] = [];
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Ensure />));
  expect(s.post).toHaveBeenCalledTimes(1);
});
