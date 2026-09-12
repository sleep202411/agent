import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewInvitations, useMyCrewInvitation } from "./use-invitations";

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

it("hides invitation lists and details on logout and while another account loads", async () => {
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.includes("crew-invitations")
      ? { id: "private-invitation", events: [] }
      : { items: [{ id: "private-invitation" }], nextCursor: null }
  );
  const view = mount(() => ({
    list: useCrewInvitations("crew-1"),
    detail: useMyCrewInvitation("private-invitation"),
  }));
  await settle();
  expect(view.current().list.data).toHaveLength(1);
  expect(view.current().detail.data?.id).toBe("private-invitation");
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
