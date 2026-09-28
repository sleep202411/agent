import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi, CrewApiError } from "./api";
import { useCrewPermissions } from "./use-crew-permissions";
import { useCrewMembers, useCrewMembership } from "./use-members";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
  useUserInfo: () => ({ data: { nickName: "Alice" } }),
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  crewApi: { get: vi.fn(), post: vi.fn() },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
function mount<T>(hook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement("div");
  root = createRoot(container);
  let result: T;
  function Probe() {
    result = hook();
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  render();
  return { current: () => result!, render };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.id = "alice";
  vi.resetAllMocks();
});

it("hides member lists and current-user permissions on logout and while another account loads", async () => {
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { id: "private-member", permissions: ["applications.review"] }
      : { items: [{ id: "private-member" }], nextCursor: null }
  );
  const view = mount(() => ({
    list: useCrewMembers("crew-1"),
    detail: useCrewMembership("crew-1"),
  }));
  await settle();
  expect(view.current().list.data).toHaveLength(1);
  expect(view.current().detail.data).toMatchObject({ permissions: ["applications.review"] });
  session.id = null;
  view.render();
  expect(view.current().list.data).toEqual([]);
  expect(view.current().detail.data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().list.data).toEqual([]);
  expect(view.current().detail.data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(4);
});

it("revokes cached UI authority after a failed membership refresh and restores it after recovery", async () => {
  const member = {
    userId: "alice",
    member: { isOwner: true, policyKeys: ["admin"] },
    permissions: ["applications.review", "tasks.manage"],
  };
  vi.mocked(crewApi.get).mockResolvedValue(member);
  const view = mount(() => ({
    membership: useCrewMembership("crew-1"),
    permissions: useCrewPermissions("crew-1"),
  }));
  await settle();
  expect(view.current().permissions.can("tasks.manage")).toBe(true);
  vi.mocked(crewApi.get).mockRejectedValue(new CrewApiError(403, "Membership revoked"));
  await act(async () => {
    await view.current().membership.refetch();
  });
  await settle();
  expect(view.current().membership.data).toEqual(member); // React Query retains the old snapshot.
  expect(view.current().permissions.can("tasks.manage")).toBe(false);
  expect(view.current().permissions.isOwner).toBe(false);
  expect(view.current().permissions.isMember).toBe(false);
  expect(view.current().permissions.policyKeys).toEqual([]);
  vi.mocked(crewApi.get).mockResolvedValue(member);
  await act(async () => {
    await view.current().membership.refetch();
  });
  await settle();
  expect(view.current().permissions.can("tasks.manage")).toBe(true);
});
