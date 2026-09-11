import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import {
  useApplyToPosition,
  useApproveApplication,
  useRejectApplication,
} from "./use-applications";
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
  const apply = useApplyToPosition(crewId, "position");
  const approve = useApproveApplication(crewId);
  const reject = useRejectApplication(crewId);
  return {
    apply: () => apply.mutateAsync({}),
    approve: () => approve.mutateAsync("application"),
    reject: () => reject.mutateAsync("application"),
  };
}

it.each(["apply", "approve", "reject"] as const)(
  "refreshes application counts and related views after delayed %s",
  async (operation) => {
    let complete!: (value: unknown) => void;
    vi.mocked(crewApi.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    let crewId = "original";
    const view = mount(() => useActions(crewId));
    const expected = [
      [...crewKeys.applications("original"), "all", 50, "alice"],
      [...crewKeys.application("original", "application"), "alice"],
      [...crewKeys.positions("original"), "alice", 50],
      [...crewKeys.detail("original"), "alice"],
      [...crewKeys.mine, "alice"],
    ];
    if (operation === "approve")
      expected.push(
        [...crewKeys.members("original"), "list", 50, "alice"],
        ["crew", "positions", "public"],
        ["crew", "list", "infinite", 24, "alice"],
        [...crewKeys.byUser("creator"), "alice"]
      );
    const untouched = [
      [...crewKeys.applications("original"), "all", 50, "bob"],
      [...crewKeys.positions("original"), "bob", 50],
      [...crewKeys.detail("later"), "bob"],
      [...crewKeys.members("later"), "list", 50, "bob"],
      [...crewKeys.mine, "bob"],
    ];
    for (const key of [...expected, ...untouched]) client.setQueryData(key, {});
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view.current()[operation]();
    });
    session.id = "bob";
    crewId = "later";
    view.render();
    await act(async () => {
      complete({ id: "application" });
      await pending;
    });
    for (const key of expected)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    for (const key of untouched)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
  }
);
