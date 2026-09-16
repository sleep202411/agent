import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewList, usePublicCreatorCrews, useMyCrews } from "./use-crew-list";

import { useCrewDetail } from "./use-crew-detail";
import { useCrewPositions } from "./use-positions";

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

it("keeps viewer-filtered plaza and creator lists separate across account changes", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "alice-visible" }], nextCursor: null });
  const view = mount(() => ({ plaza: useCrewList(), creator: usePublicCreatorCrews("creator") }));
  await settle();
  expect(view.current().plaza.data?.pages[0].items[0].id).toBe("alice-visible");
  expect(view.current().creator.data?.items[0].id).toBe("alice-visible");
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().plaza.data).toBeUndefined();
  expect(view.current().creator.data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(4);
  session.id = null;
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "public" }], nextCursor: null });
  view.render();
  await settle();
  expect(view.current().plaza.data?.pages[0].items[0].id).toBe("public");
  expect(view.current().creator.data?.items[0].id).toBe("public");
});

it("waits for account resolution before requesting viewer-filtered lists", async () => {
  session.id = null;
  session.loading = true;
  const view = mount(() => ({ plaza: useCrewList(), creator: usePublicCreatorCrews("creator") }));
  await settle();
  expect(crewApi.get).not.toHaveBeenCalled();
  session.loading = false;
  vi.mocked(crewApi.get).mockResolvedValue({ items: [], nextCursor: null });
  view.render();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
});

it("abandons viewer-dependent Crew reads on account replacement while retaining guest access", async () => {
  const reads: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  vi.mocked(crewApi.get).mockImplementation((_path, options) => {
    expect(options?.cache).toBe("no-store");
    return new Promise((resolve) =>
      reads.push({ signal: options!.signal as AbortSignal, resolve })
    );
  });
  const view = mount(() => [
    useCrewList(),
    useMyCrews(),
    usePublicCreatorCrews("creator"),
    useCrewDetail("crew"),
    useCrewPositions("crew"),
  ]);
  expect(reads).toHaveLength(5);
  session.id = null;
  view.render();
  expect(reads).toHaveLength(9);
  expect(reads.slice(0, 5).every((read) => read.signal.aborted)).toBe(true);
  expect(reads.slice(5).every((read) => !read.signal.aborted)).toBe(true);
  await act(async () =>
    reads.slice(0, 5).forEach((read) => read.resolve({ items: [], nextCursor: null }))
  );
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => query.state.data === undefined)
  ).toBe(true);
});
