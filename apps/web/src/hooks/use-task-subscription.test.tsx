import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ dispatch: vi.fn(), get: vi.fn(), tasks: {} }));
vi.mock("@/src/store", () => ({
  store: { getState: () => ({ task: { tasks: s.tasks } }) },
  useAppDispatch: () => s.dispatch,
}));
vi.mock("@/src/lib/api", () => ({ api: { get: s.get } }));
import { useTaskFetch } from "./use-task-subscription";
let root: Root;
const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
function View({ user = "a" }: { user?: string }) {
  useTaskFetch(user);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.dispatch.mockReset();
  pending.length = 0;
  s.tasks = { local: { id: "local" } };
  s.get.mockImplementation(
    (_url, options) =>
      new Promise((resolve) => {
        pending.push({ signal: options.signal, resolve });
      })
  );
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("reconciles against the captured snapshot without clearing local tasks on admission", async () => {
  await act(async () => root.render(<View />));
  expect(s.dispatch).not.toHaveBeenCalled();
  const baseline = s.tasks;
  s.tasks = {};
  await act(async () => pending[0].resolve([{ id: "remote" }]));
  expect(s.dispatch.mock.calls[0][0].payload).toEqual({ baseline, tasks: [{ id: "remote" }] });
});
it("cancels obsolete reads and restarts after Strict Mode cleanup", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <View />
      </StrictMode>
    )
  );
  expect(pending).toHaveLength(2);
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[0].resolve([{ id: "obsolete" }]));
  expect(s.dispatch).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(pending[1].signal.aborted).toBe(true);
  await act(async () => pending[1].resolve([{ id: "late" }]));
  expect(s.dispatch).not.toHaveBeenCalled();
});
