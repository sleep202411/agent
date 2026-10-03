// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({
  user: "a",
  ws: { id: "team-a", name: "Team A", role: "owner", isDefault: false },
  error: null as Error | null,
  loading: false,
  members: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  select: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  balance: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.failure } }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: state.user },
    isCurrentAccount: (id: string) => id === state.user,
  }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({
    activeWorkspace: state.ws,
    loading: state.loading,
    error: state.error,
    fetching: false,
    refresh: state.refresh,
    setActiveWorkspaceId: state.select,
    workspaces: [{ id: "personal", isDefault: true }],
  }),
}));
vi.mock("@/app/_components/credits-badge", () => ({ useComputeWalletBalance: state.balance }));
vi.mock("@/lib/collab/sharing-api", () => ({ listWorkspaceMembers: state.members }));
vi.mock("@/lib/collab/projects-api", () => ({
  updateWorkspace: state.rename,
  deleteWorkspace: state.remove,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const render = async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
  await settle();
};
const button = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent === label).at(-1)!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.user = "a";
  state.ws = { id: "team-a", name: "Team A", role: "owner", isDefault: false };
  state.error = null;
  state.loading = false;
  state.members.mockResolvedValue([]);
  state.balance.mockReturnValue({
    data: { available: BigInt(20) },
    refetch: vi.fn(),
    isFetching: false,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
it("shows the workspace error with retry instead of an endless skeleton", async () => {
  state.error = new Error("Workspace service unavailable");
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Workspace service unavailable"
  );
  act(() => button("retry").click());
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("does not misreport a failed member read as an empty team and recovers", async () => {
  state.members.mockRejectedValueOnce(new Error("Membership read failed"));
  await render();
  expect(host.textContent).toContain("Membership read failed");
  expect(host.textContent).not.toContain("noMembersYet");
  state.members.mockResolvedValue([
    { memberId: "member", nickname: "Returned Member", userId: "member" },
  ]);
  act(() => button("retry").click());
  await settle();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(state.members).toHaveBeenCalledTimes(2);
});
it("isolates member caches by account and uses the selected workspace balance", async () => {
  await render();
  expect(state.balance).toHaveBeenCalledWith(true, "team-a");
  state.user = "b";
  await render();
  expect(state.members).toHaveBeenCalledTimes(2);
});
it("does not apply a delayed delete to a newly selected workspace", async () => {
  let resolve!: () => void;
  state.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  act(() => button("deleteTeam").click());
  await act(async () => button("deleteTeam").click());
  const signal = state.remove.mock.calls[0]![1] as AbortSignal;
  state.ws = { ...state.ws, id: "team-b", name: "Team B" };
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("deleteTeamConfirmTitle");
  await act(async () => resolve());
  expect(state.select).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  expect(state.success).not.toHaveBeenCalled();
});
it("cancels a rename on account replacement without publishing stale success", async () => {
  let resolve!: (v: unknown) => void;
  state.rename.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  const input = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Renamed"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(state.rename).toHaveBeenCalledOnce();
  const signal = state.rename.mock.calls[0]![2] as AbortSignal;
  state.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ...state.ws, name: "Renamed" }));
  expect(state.success).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("shows balance errors and retries without changing the workspace", async () => {
  const refetch = vi.fn();
  state.balance.mockReturnValue({
    error: new Error("Balance unavailable"),
    refetch,
    isFetching: false,
  });
  await render();
  expect(host.textContent).toContain("Balance unavailable");
  act(() => button("retry").click());
  expect(refetch).toHaveBeenCalledOnce();
  expect(state.select).not.toHaveBeenCalled();
});

it("completes deletion in the same workspace and selects the personal workspace", async () => {
  state.remove.mockResolvedValue(undefined);
  await render();
  act(() => button("deleteTeam").click());
  await act(async () => button("deleteTeam").click());
  expect(state.remove).toHaveBeenCalledWith("team-a", expect.any(AbortSignal));
  expect(state.select).toHaveBeenCalledWith("personal");
  expect(state.push).toHaveBeenCalledWith("/settings/overview");
  expect(state.success).toHaveBeenCalledWith("teamDeleted");
});

it("does not submit a rename from a read-only workspace", async () => {
  state.ws.role = "viewer";
  await render();
  expect(host.querySelector("input")?.disabled).toBe(true);
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(state.rename).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("deleteTeam");
});
