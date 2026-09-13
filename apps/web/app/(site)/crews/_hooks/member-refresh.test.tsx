import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useRemoveMember, useUpdateMember, useTransferCrewOwner } from "./use-members";
import { crewKeys } from "./shared";

const session = vi.hoisted(() => ({ id: "alice" as string | null, loading: false }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({
    user: session.id ? { id: session.id } : null,
    isLoading: session.loading,
  }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  crewApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.id = "alice";
  session.loading = false;
  vi.resetAllMocks();
});

function useActions(crewId: string) {
  const remove = useRemoveMember(crewId);
  const update = useUpdateMember(crewId);
  const transfer = useTransferCrewOwner(crewId);
  return {
    remove: () => remove.mutateAsync("member"),
    update: () =>
      update.mutateAsync({ memberId: "member", input: { policyKeys: [], expectedVersion: 1 } }),
    transfer: () => transfer.mutateAsync({ toUserId: "new-owner", removeOldOwner: true }),
  };
}
it.each(["remove", "update", "transfer"] as const)(
  "refreshes original membership caches after delayed %s",
  async (operation) => {
    let complete!: (value: unknown) => void;
    const response = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    vi.mocked(crewApi.post).mockImplementation(response);
    vi.mocked(crewApi.patch).mockImplementation(response);
    vi.mocked(crewApi.delete).mockImplementation(response);
    let crewId = "original";
    const view = mount(() => useActions(crewId));
    const keys = (crew: string, user: string) => [
      [...crewKeys.members(crew), "list", 50, user],
      [...crewKeys.membership(crew), user],
      [...crewKeys.detail(crew), user],
      [...crewKeys.positions(crew), user, 50],
      [...crewKeys.mine, user],
      [...crewKeys.taskCenter, user, "all", "active", ""],
    ];
    const expected = keys("original", "alice").concat([
      ["crew", "positions", "public"],
      ["crew", "list", "infinite", 24, "alice"],
      [...crewKeys.byUser("creator"), "alice"],
    ]);
    const untouched = keys("original", "bob").concat(keys("later", "bob"));
    for (const key of [...expected, ...untouched]) client.setQueryData(key, {});
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view.current()[operation]();
    });
    crewId = "later";
    session.id = "bob";
    view.render();
    await act(async () => {
      complete({});
      await pending;
    });
    for (const key of expected)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    for (const key of untouched)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
  }
);
