// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSettingsGate } from "./workspace-settings-gate";
const state = vi.hoisted(() => ({
  activeWorkspace: null as { id: string } | null,
  loading: false,
  error: null as Error | null,
  fetching: false,
  refresh: vi.fn(),
  mounted: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/app/_components/workspace-context", () => ({ useWorkspace: () => state }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
function Controls() {
  useEffect(() => {
    state.mounted();
    return state.cleanup;
  }, []);
  return <button>Workspace action</button>;
}
let root: Root, host: HTMLDivElement;
async function render() {
  await act(async () =>
    root.render(
      <WorkspaceSettingsGate title="Workspace settings">
        <Controls />
      </WorkspaceSettingsGate>
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  Object.assign(state, { activeWorkspace: null, loading: false, error: null, fetching: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("does not mount scoped controls until workspace lookup recovers", async () => {
  state.loading = true;
  await render();
  expect(state.mounted).not.toHaveBeenCalled();
  state.loading = false;
  state.error = new Error("Workspace service unavailable");
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Workspace service unavailable"
  );
  act(() => host.querySelector("button")!.click());
  expect(state.refresh).toHaveBeenCalledOnce();
  state.fetching = true;
  await render();
  expect(host.querySelector("button")!.disabled).toBe(true);
  state.fetching = false;
  state.error = null;
  state.activeWorkspace = { id: "team" };
  await render();
  expect(state.mounted).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Workspace action");
});
it("unmounts controls on a failed refresh even when a stale workspace remains", async () => {
  state.activeWorkspace = { id: "team" };
  await render();
  state.error = new Error("Access lookup failed");
  await render();
  expect(state.cleanup).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Workspace action");
});
it("offers retry when the lookup completes without a workspace", async () => {
  await render();
  expect(host.textContent).toContain("workspaceUnavailable");
  act(() => host.querySelector("button")!.click());
  expect(state.refresh).toHaveBeenCalledOnce();
});
