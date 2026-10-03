// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharactersGrid } from "./characters-grid";
const state = vi.hoisted(() => ({
  workspace: {
    activeWorkspace: null as { id: string } | null,
    loading: false,
    error: null as Error | null,
    fetching: false,
    refresh: vi.fn(),
  },
  query: {
    isError: false,
    error: null as Error | null,
    isPending: false,
    isFetching: false,
    data: [],
    refetch: vi.fn(),
  },
  user: { id: "a" } as { id: string } | null,
  authLoading: false,
  scopes: vi.fn(),
}));
vi.mock("@/app/_components/workspace-context", () => ({ useWorkspace: () => state.workspace }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.user, loading: state.authLoading, signIn: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ Link: "a", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../_lib/use-characters", () => ({
  useCharacters: (scope: string | null) => {
    state.scopes(scope);
    return state.query;
  },
  useCharactersRealtime: () => {},
  charactersKeys: {},
}));
vi.mock("./create-character-dialog", () => ({ CreateCharacterDialog: () => null }));
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<CharactersGrid />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Object.assign(state.workspace, {
    activeWorkspace: null,
    loading: false,
    error: null,
    fetching: false,
  });
  Object.assign(state.query, { isError: false, error: null, isPending: false, isFetching: false });
  state.user = { id: "a" };
  state.authLoading = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("recovers workspace lookup instead of leaving the character library loading", async () => {
  state.workspace.loading = true;
  await render();
  expect(host.textContent).not.toContain("workspaceUnavailable");
  state.workspace.loading = false;
  state.workspace.error = new Error("Workspace access service unavailable");
  await render();
  expect(host.textContent).toContain("Workspace access service unavailable");
  expect(state.scopes).toHaveBeenLastCalledWith(null);
  act(() => host.querySelector("button")!.click());
  expect(state.workspace.refresh).toHaveBeenCalledOnce();
  expect(state.query.refetch).not.toHaveBeenCalled();
  state.workspace.fetching = true;
  await render();
  expect(host.querySelector("button")!.disabled).toBe(true);
  state.workspace.fetching = false;
  state.workspace.error = null;
  state.workspace.activeWorkspace = { id: "team" };
  await render();
  expect(state.scopes).toHaveBeenLastCalledWith("team");
  expect(host.textContent).toContain("createCharacter");
});
it("blocks a stale workspace and offers recovery for a missing workspace", async () => {
  state.workspace.activeWorkspace = { id: "stale" };
  state.workspace.error = new Error("Membership lookup failed");
  await render();
  expect(state.scopes).toHaveBeenLastCalledWith(null);
  expect(host.textContent).not.toContain("createCharacter");
  state.workspace.error = null;
  state.workspace.activeWorkspace = null;
  await render();
  expect(host.textContent).toContain("workspaceUnavailable");
});
it("keeps character read failures distinct from workspace failures", async () => {
  state.workspace.activeWorkspace = { id: "team" };
  state.query.isError = true;
  state.query.error = new Error("Character service unavailable");
  await render();
  expect(host.textContent).toContain("Character service unavailable");
  act(() => host.querySelector("button")!.click());
  expect(state.query.refetch).toHaveBeenCalledOnce();
  expect(state.workspace.refresh).not.toHaveBeenCalled();
});
it("preserves the sign-in action for signed-out visitors", async () => {
  state.user = null;
  await render();
  expect(host.textContent).toContain("signInTitle");
  expect(host.textContent).not.toContain("workspaceUnavailable");
});
