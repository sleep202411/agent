import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewPositions } from "./use-positions";
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
  crewApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
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
  session.loading = false;
  vi.resetAllMocks();
});

it("isolates manager-only positions across accounts and preserves public reads", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({
    items: [{ id: "frozen", status: "frozen" }],
    total: 1,
    nextCursor: null,
  });
  const view = mount(() => useCrewPositions("crew"));
  await settle();
  expect(view.current().data[0]?.id).toBe("frozen");
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().data).toEqual([]);
  expect(view.current().total).toBe(0);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  session.id = null;
  vi.mocked(crewApi.get).mockResolvedValue({
    items: [{ id: "public" }],
    total: 1,
    nextCursor: null,
  });
  view.render();
  await settle();
  expect(view.current().data[0]?.id).toBe("public");
});

it("does not automatically paginate cached public results during account resolution", async () => {
  session.id = null;
  session.loading = true;
  const view = mount(() => useCrewPositions("crew"));
  await act(async () => {
    client.setQueryData([...crewKeys.positions("crew"), null, 50], {
      pages: [{ items: [{ id: "public" }], total: 2, nextCursor: "public" }],
      pageParams: [undefined],
    });
  });
  await settle();
  expect(crewApi.get).not.toHaveBeenCalled();
  session.loading = false;
  vi.mocked(crewApi.get).mockResolvedValue({
    items: [{ id: "second" }],
    total: 2,
    nextCursor: null,
  });
  view.render();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(1);
  expect(view.current().data.map((item) => item.id)).toEqual(["public", "second"]);
});
