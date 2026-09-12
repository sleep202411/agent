import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import {
  useCrewAssetContext,
  useCrewAssets,
  useCrewAssetFolders,
  useCrewAssetLocation,
  useCrewAssetPermissions,
  useCrewAssetPermissionEvents,
  useCreateCrewAssetFolder,
} from "../[id]/workspace/_hooks/use-crew-assets";
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

it("isolates every asset read across logout and account switching", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "private" }], nextCursor: null });
  const view = mount(() => [
    useCrewAssetContext("crew"),
    useCrewAssets("crew", { source: "favorites", sort: "name" }, true),
    useCrewAssetFolders("crew"),
    useCrewAssetLocation("crew", "node"),
    useCrewAssetPermissions("crew", "node"),
    useCrewAssetPermissionEvents("crew", "node"),
  ]);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(6);
  expect(view.current().every((query) => query.data !== undefined)).toBe(true);
  session.id = null;
  view.render();
  expect(view.current().every((query) => query.data === undefined)).toBe(true);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(6);
  session.id = "bob";
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  view.render();
  expect(view.current().every((query) => query.data === undefined)).toBe(true);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(12);
});

it.each(["success", "failure"])(
  "scopes delayed mutation %s recovery to its original account and Crew",
  async (outcome) => {
    let complete!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    vi.mocked(crewApi.post).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          complete = resolve;
          fail = reject;
        })
    );
    let crewId = "original";
    const view = mount(() => useCreateCrewAssetFolder(crewId));
    const originalKey = [...crewKeys.assetContext("original"), "alice"];
    const otherAccountKey = [...crewKeys.assetContext("original"), "bob"];
    const otherCrewKey = [...crewKeys.assetContext("later"), "bob"];
    for (const key of [originalKey, otherAccountKey, otherCrewKey])
      client.setQueryData(key, { storageAvailable: true });
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view
        .current()
        .mutateAsync({ name: "folder", parentId: null })
        .catch((error) => error);
    });
    session.id = "bob";
    crewId = "later";
    view.render();
    await act(async () => {
      if (outcome === "success") complete({ id: "folder" });
      else fail(new Error("Unavailable"));
      await pending;
    });
    expect(client.getQueryState(originalKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherAccountKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherCrewKey)?.isInvalidated).toBe(false);
  }
);
