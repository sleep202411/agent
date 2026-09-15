import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import {
  useCrewProductionOverview,
  useCrewProductionActivity,
  useCrewEpisodes,
  useSaveCrewProductionDocument,
  useReorderCrewEpisode,
} from "./use-production";
import { crewKeys } from "./shared";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
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

it("hides production reads after logout and while another account loads", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ items: [], nextCursor: null, privateMarker: "alice" });
  const view = mount(() => [
    useCrewProductionOverview("crew"),
    useCrewProductionActivity("crew"),
    useCrewEpisodes("crew"),
  ]);
  await settle();
  expect(view.current().every((q) => q.data !== undefined)).toBe(true);
  session.id = null;
  view.render();
  expect(view.current().every((q) => q.data === undefined)).toBe(true);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(3);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().every((q) => q.data === undefined)).toBe(true);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(6);
});

it("applies delayed document saves only to the initiating account and Crew", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(crewApi.patch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  let crew = "crew";
  const view = mount(() => useSaveCrewProductionDocument(crew));
  const aliceKey = [...crewKeys.productionOverview("crew"), "alice"];
  const bobKey = [...crewKeys.productionOverview("other"), "bob"];
  client.setQueryData(aliceKey, { page: { version: 1 } });
  client.setQueryData(bobKey, { page: { version: 1 } });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view
      .current()
      .mutateAsync({ expectedVersion: 1, document: { type: "doc", content: [] } });
  });
  session.id = "bob";
  crew = "other";
  view.render();
  await act(async () => {
    resolve({ version: 2 });
    await pending;
  });
  expect(client.getQueryData(aliceKey)).toEqual({ page: { version: 2 } });
  expect(client.getQueryData(bobKey)).toEqual({ page: { version: 1 } });
});

it("a late failed reorder refreshes only its original production caches", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(crewApi.post).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const view = mount(() => useReorderCrewEpisode("crew"));
  const aliceKey = [...crewKeys.episodes("crew"), "alice"];
  const bobKey = [...crewKeys.episodes("crew"), "bob"];
  client.setQueryData(aliceKey, []);
  client.setQueryData(bobKey, []);
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view
      .current()
      .mutateAsync({
        episodeId: "episode",
        expectedVersion: 1,
        beforeEpisodeId: null,
        afterEpisodeId: null,
      })
      .catch((e) => e);
  });
  session.id = "bob";
  view.render();
  await act(async () => {
    reject(new Error("conflict"));
    await pending;
  });
  expect(client.getQueryState(aliceKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(bobKey)?.isInvalidated).toBe(false);
});
