import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCreatePosition, useUpdatePosition, useDeletePosition } from "./use-positions";
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

it.each(["create", "update", "delete"])(
  "refreshes recruitment views after %s, scoped to the original Crew and account",
  async (operation) => {
    let complete!: (value: unknown) => void;
    const pendingResponse = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    vi.mocked(crewApi.post).mockImplementation(pendingResponse);
    vi.mocked(crewApi.patch).mockImplementation(pendingResponse);
    vi.mocked(crewApi.delete).mockImplementation(pendingResponse);
    let crewId = "original";
    const view = mount(() => ({
      create: useCreatePosition(crewId),
      update: useUpdatePosition(crewId),
      remove: useDeletePosition(crewId),
    }));
    const expectedKeys = [
      [...crewKeys.positions("original"), "alice", 50],
      [...crewKeys.detail("original"), "alice"],
      ["crew", "positions", "public", "newest"],
      ["crew", "list", "infinite", 24, "alice"],
      [...crewKeys.mine, "alice"],
      [...crewKeys.byUser("creator"), "alice"],
    ];
    const untouchedKeys = [
      [...crewKeys.positions("original"), "bob", 50],
      [...crewKeys.positions("later"), "alice", 50],
      [...crewKeys.detail("later"), "bob"],
      [...crewKeys.mine, "bob"],
      [...crewKeys.byUser("creator"), "bob"],
      ["crew", "list", "infinite", 24, "bob"],
    ];
    for (const key of [...expectedKeys, ...untouchedKeys]) client.setQueryData(key, {});
    let pending!: Promise<unknown>;
    await act(async () => {
      pending =
        operation === "create"
          ? view.current().create.mutateAsync({
              positionType: "director",
              description: "Opening",
              targetCount: 1,
            })
          : operation === "update"
            ? view.current().update.mutateAsync({ positionId: "position", status: "frozen" })
            : view.current().remove.mutateAsync("position");
    });
    session.id = "bob";
    crewId = "later";
    view.render();
    await act(async () => {
      complete({ id: "position" });
      await pending;
    });
    for (const key of expectedKeys)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    for (const key of untouchedKeys)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
  }
);
