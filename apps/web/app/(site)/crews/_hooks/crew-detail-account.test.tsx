import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewDetail, useUpdateCrew, useUpdateCrewListing } from "./use-crew-detail";
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

it("hides owner details after logout and account switching while retaining public reads", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ id: "crew", pendingApplicationCount: 5 });
  const view = mount(() => useCrewDetail("crew"));
  await settle();
  expect(view.current().data?.pendingApplicationCount).toBe(5);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = null;
  view.render();
  expect(view.current().data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  session.id = "bob";
  view.render();
  expect(view.current().data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(3);
});

it("waits for account resolution before requesting public Crew details", async () => {
  session.id = null;
  session.loading = true;
  const view = mount(() => useCrewDetail("crew"));
  await settle();
  expect(crewApi.get).not.toHaveBeenCalled();
  session.loading = false;
  vi.mocked(crewApi.get).mockResolvedValue({ id: "crew", name: "Public" });
  view.render();
  await settle();
  expect(view.current().data?.name).toBe("Public");
});

it.each(["edit", "listing"])(
  "keeps delayed %s results in the initiating account",
  async (operation) => {
    let complete!: (value: unknown) => void;
    vi.mocked(crewApi.patch).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const view = mount(() => ({ edit: useUpdateCrew(), listing: useUpdateCrewListing() }));
    const bobKey = [...crewKeys.detail("crew"), "bob"];
    client.setQueryData(bobKey, { id: "crew", name: "Bob view", version: 1 });
    let pending!: Promise<unknown>;
    await act(async () => {
      pending =
        operation === "edit"
          ? view.current().edit.mutateAsync({ id: "crew", name: "Confirmed", expectedVersion: 1 })
          : view
              .current()
              .listing.mutateAsync({ id: "crew", listingStatus: "listed", expectedVersion: 1 });
    });
    session.id = "bob";
    view.render();
    const confirmed = { id: "crew", name: "Confirmed", version: 2 };
    await act(async () => {
      complete(confirmed);
      await pending;
    });
    expect(client.getQueryData([...crewKeys.detail("crew"), "alice"])).toEqual(confirmed);
    expect(client.getQueryData(bobKey)).toEqual({ id: "crew", name: "Bob view", version: 1 });
  }
);
