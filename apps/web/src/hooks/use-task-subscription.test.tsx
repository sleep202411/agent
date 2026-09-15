import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a" as string | undefined, dispatch: vi.fn(), get: vi.fn() }));
vi.mock("@/src/store", () => ({
  store: { getState: () => ({ task: { tasks: {} } }) },
  useAppDispatch: () => s.dispatch,
}));
vi.mock("@/src/lib/api", () => ({ api: { get: s.get } }));
import { useTaskFetch } from "./use-task-subscription";
let root: Root;
const pending: {
  signal: AbortSignal;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}[] = [];
let status: ReturnType<typeof useTaskFetch>;
function View() {
  const current = useTaskFetch(s.user);
  useLayoutEffect(() => {
    status = current;
  });
  return null;
}
async function render(strict = false) {
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <View />
        </StrictMode>
      ) : (
        <View />
      )
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.dispatch.mockReset();
  pending.length = 0;
  s.get.mockImplementation(
    (_url, options) =>
      new Promise((resolve, reject) => pending.push({ signal: options.signal, resolve, reject }))
  );
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("clears prior tasks and fetches the replacement account instead of keeping a one-time latch", async () => {
  await render();
  await act(async () => pending[0].resolve([{ id: "a" }]));
  s.user = "b";
  await render();
  expect(pending).toHaveLength(2);
  expect(pending[0].signal.aborted).toBe(true);
  expect(s.dispatch.mock.calls.at(-1)![0].payload).toBe("b");
  await act(async () => pending[1].resolve([{ id: "b" }]));
  expect(s.dispatch.mock.calls.at(-1)![0].payload.tasks).toEqual([{ id: "b" }]);
});
it("suppresses late results after unmount", async () => {
  await render();
  await act(async () => root.render(null));
  const count = s.dispatch.mock.calls.length;
  await act(async () => pending[0].resolve([{ id: "old" }]));
  expect(pending[0].signal.aborted).toBe(true);
  expect(s.dispatch).toHaveBeenCalledTimes(count);
});
it("restarts after Strict Mode cleanup and leaves guest tasks empty", async () => {
  await render(true);
  expect(pending).toHaveLength(2);
  expect(pending[0].signal.aborted).toBe(true);
  expect(pending[1].signal.aborted).toBe(false);
  s.user = undefined;
  await render(true);
  expect(pending[1].signal.aborted).toBe(true);
  expect(s.dispatch.mock.calls.at(-1)![0].payload).toBeNull();
  expect(pending).toHaveLength(2);
});

it("surfaces failed reads and guards repeated retries without clearing loaded snapshots", async () => {
  await render();
  expect(status.isLoading).toBe(true);
  await act(async () => pending[0].reject(new Error("Offline")));
  expect(status.error).toBe("Offline");
  expect(status.isLoading).toBe(false);
  const cleared = s.dispatch.mock.calls.length;
  await act(async () => {
    status.retry();
    status.retry();
  });
  expect(pending).toHaveLength(2);
  expect(s.dispatch).toHaveBeenCalledTimes(cleared);
  await act(async () => pending[1].resolve([{ id: "recovered" }]));
  expect(status.error).toBeNull();
  expect(status.isLoading).toBe(false);
});
it("does not display an old account's failed read in its replacement", async () => {
  await render();
  await act(async () => pending[0].reject(new Error("Private error")));
  s.user = "b";
  await render();
  expect(status.error).toBeNull();
  expect(status.isLoading).toBe(true);
});
