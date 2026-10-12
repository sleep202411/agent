import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useStoryGenerationBatch } from "./use-story-generation-batch";
const state = vi.hoisted(() => ({
  token: "first",
  get: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
  assets: vi.fn(),
  storyboard: vi.fn(),
}));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { id: "alice" },
    session: { region: "com", token: { tokenName: "satoken", tokenValue: state.token } },
  }),
}));
vi.mock("../api/story-production-api", () => ({
  storyGenerationBatchHasPendingItems: () => false,
  storyProductionApi: {
    getGenerationBatch: state.get,
    cancelGenerationBatch: state.cancel,
    resumeGenerationBatch: state.resume,
    listAssetSpecs: state.assets,
    getStoryboard: state.storyboard,
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project = "0195bcaa-1000-7000-8000-000000000001",
  chapter = "0195bcaa-1000-7000-8000-000000000002",
  batchId = "0195bcaa-1000-7000-8000-000000000003";
const batch = { id: batchId, status: "completed", items: [] };
let root: Root;
let current: ReturnType<typeof useStoryGenerationBatch>;
function Probe() {
  // Publish the mounted hook result to the test driver.
  // eslint-disable-next-line react-hooks/globals
  current = useStoryGenerationBatch(project, chapter, batchId);
  return null;
}
async function render() {
  await act(async () => root.render(createElement(Probe)));
}
async function mount() {
  root = createRoot(document.createElement("div"));
  await render();
}
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  act(() => root?.unmount());
  vi.resetAllMocks();
  state.token = "first";
});
it("serializes cancel/resume synchronously and keeps active failures retryable", async () => {
  state.get.mockResolvedValue(batch);
  const request = deferred();
  state.cancel.mockReturnValue(request.promise);
  await mount();
  let pending!: Promise<void>;
  await act(async () => {
    pending = current.cancel();
    void current.resume();
    void current.cancel();
    current.retry();
  });
  expect(state.cancel).toHaveBeenCalledTimes(1);
  expect(state.resume).not.toHaveBeenCalled();
  expect(current.mutating).toBe(true);
  await act(async () => {
    request.reject(new Error("retry me"));
    await pending;
  });
  expect(current.mutating).toBe(false);
  expect(current.cancelError).toBe("retry me");
  expect(current.resumeError).toBeNull();
  state.get.mockResolvedValue({ ...batch, status: "running" });
  await act(async () => current.retry());
  expect(current.cancelError).toBe("retry me");
  state.resume.mockResolvedValue(batch);
  await act(async () => current.resume());
  expect(state.resume).toHaveBeenCalledTimes(1);
  expect(current.cancelError).toBe("retry me");
  expect(current.resumeError).toBeNull();
});
it("aborts old actions and preserves a replacement claim on credential change", async () => {
  state.get.mockResolvedValue(batch);
  const old = deferred(),
    replacement = deferred();
  state.cancel.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
  await mount();
  const retained = current;
  let oldPending!: Promise<void>;
  await act(async () => {
    oldPending = current.cancel();
  });
  const oldSignal = state.cancel.mock.calls[0]![3] as AbortSignal;
  state.token = "second";
  await render();
  expect(oldSignal.aborted).toBe(true);
  expect(current.mutating).toBe(false);
  await act(async () => {
    void retained.resume();
    retained.retry();
  });
  expect(state.resume).not.toHaveBeenCalled();
  let newPending!: Promise<void>;
  await act(async () => {
    newPending = current.cancel();
  });
  await act(async () => {
    old.resolve({ ...batch, id: "old" });
    await oldPending;
  });
  expect(current.mutating).toBe(true);
  expect(current.batch?.id).toBe(batchId);
  await act(async () => {
    replacement.resolve(batch);
    await newPending;
  });
  expect(current.mutating).toBe(false);
});
it("cancels an overlapping read before mutation and ignores its late result", async () => {
  const read = deferred();
  state.get.mockReturnValueOnce(read.promise).mockResolvedValue(batch);
  const action = deferred();
  state.resume.mockReturnValue(action.promise);
  await mount();
  const signal = state.get.mock.calls[0]![3] as AbortSignal;
  let pending!: Promise<void>;
  await act(async () => {
    pending = current.resume();
  });
  expect(signal.aborted).toBe(true);
  await act(async () => read.resolve({ ...batch, id: "stale" }));
  expect(current.batch).toBeNull();
  await act(async () => {
    action.resolve(batch);
    await pending;
  });
  expect(current.batch?.id).toBe(batchId);
});
it("clears stale asset rows when the refreshed batch has no target items", async () => {
  state.get
    .mockResolvedValueOnce({ ...batch, items: [{ targetKind: "asset_spec" }] })
    .mockResolvedValue(batch);
  state.assets.mockResolvedValue([{ id: "asset" }]);
  await mount();
  expect(current.assets).toHaveLength(1);
  await act(async () => current.retry());
  expect(current.assets).toEqual([]);
  expect(current.storyboard).toEqual([]);
});
