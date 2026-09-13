import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useMyCrews, usePublicCreatorCrews } from "./use-crew-list";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: vi.fn(), post: vi.fn() } }));
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

it("hides private Crews after logout and while the next account loads", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ founded: [{ id: "unlisted-crew" }], joined: [] });
  const view = mount(() => useMyCrews());
  await settle();
  expect(view.current().data?.founded).toEqual([{ id: "unlisted-crew" }]);
  session.id = null;
  view.render();
  expect(view.current().data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(1);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
});

it("keeps public creator Crews available to signed-out visitors", async () => {
  session.id = null;
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "listed-crew" }] });
  const view = mount(() => usePublicCreatorCrews("creator-1"));
  await settle();
  expect(view.current().data?.items).toEqual([{ id: "listed-crew" }]);
});
