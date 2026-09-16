import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a" as string | null, fetched: false, dispatch: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: s.user ? { id: s.user } : null, isFetched: s.fetched }),
}));
vi.mock("@/src/store", () => ({ useAppDispatch: () => s.dispatch }));
vi.mock("@/src/lib/api", () => ({ backendApi: {} }));
import { TaskAccountBoundary } from "./task-account-boundary";
let root: Root;
async function render() {
  await act(async () => root.render(<TaskAccountBoundary />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.fetched = false;
  s.dispatch.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("waits for account resolution then synchronizes ownership without a task panel", async () => {
  await render();
  expect(s.dispatch).not.toHaveBeenCalled();
  s.fetched = true;
  await render();
  expect(s.dispatch.mock.calls.at(-1)![0].payload).toBe("a");
  s.user = "b";
  await render();
  expect(s.dispatch.mock.calls.at(-1)![0].payload).toBe("b");
});
it("clears ownership on confirmed logout", async () => {
  s.fetched = true;
  await render();
  s.user = null;
  await render();
  expect(s.dispatch.mock.calls.at(-1)![0].payload).toBeNull();
});
