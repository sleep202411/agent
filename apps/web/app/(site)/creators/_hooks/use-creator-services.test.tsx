// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  serviceKeys,
  useCreatorServices,
  useCreatorService,
  useCreateService,
  useUpdateService,
  usePublishService,
  usePauseService,
  useResumeService,
} from "./use-creator-services";
const session = vi.hoisted(() => ({ id: "alice" as string | null, loading: false }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({
    user: session.id ? { id: session.id } : null,
    isLoading: session.loading,
  }),
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  session.id = "alice";
  session.loading = false;
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", request);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["list", "detail"])(
  "isolates %s reads and aborts replaced account requests",
  async (mode) => {
    const Probe =
      mode === "list"
        ? function List() {
            const query = useCreatorServices({ creatorId: "alice" });
            return <div>{JSON.stringify(query.data)}</div>;
          }
        : function Detail() {
            const query = useCreatorService("service-1");
            return <div>{JSON.stringify(query.data)}</div>;
          };
    const render = () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      );
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    await act(async () => render());
    expect(request).toHaveBeenCalledOnce();
    const signal = request.mock.calls[0]![1]!.signal!;
    expect(request.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
    session.id = "bob";
    const bob =
      mode === "list"
        ? { items: [{ id: "bob-public-service" }], nextCursor: null }
        : { id: "bob-public-service" };
    request.mockResolvedValueOnce(Response.json(bob));
    await act(async () => render());
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(
        Response.json(
          mode === "list"
            ? { items: [{ id: "alice-draft" }], nextCursor: null }
            : { id: "alice-draft" }
        )
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("bob-public-service");
    expect(container.textContent).not.toContain("alice-draft");
    session.id = null;
    request.mockResolvedValueOnce(
      Response.json(mode === "list" ? { items: [], nextCursor: null } : { id: "guest-public" })
    );
    await act(async () => render());
    expect(container.textContent).not.toContain("bob-public-service");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]![1]).toMatchObject({ credentials: "omit", cache: "no-store" });
  }
);

const mutations = {
  useCreateService,
  useUpdateService,
  usePublishService,
  usePauseService,
  useResumeService,
};
it.each(Object.keys(mutations) as Array<keyof typeof mutations>)(
  "keeps a delayed %s result in the initiating account cache",
  async (name) => {
    const useServiceMutation = mutations[name];
    function Probe() {
      const mutation = useServiceMutation();
      return (
        <button
          onClick={() =>
            mutation.mutate({
              id: "service-1",
              body: { summary: "New draft" },
              title: "Draft",
              summary: "Fixture",
              category: "other",
            })
          }
        >
          act
        </button>
      );
    }
    const render = () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      );
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    await act(async () => render());
    await act(async () => container.querySelector("button")!.click());
    expect(request).toHaveBeenCalledOnce();
    session.id = "bob";
    const replacement = { id: "service-1", note: "Bob cache" };
    client.setQueryData(serviceKeys.detail("service-1", "bob"), replacement);
    await act(async () => render());
    const result = { id: "service-1", note: "Alice result" };
    await act(async () => finish(Response.json(result)));
    expect(client.getQueryData(serviceKeys.detail("service-1", "alice"))).toEqual(result);
    expect(client.getQueryData(serviceKeys.detail("service-1", "bob"))).toEqual(replacement);
    expect(client.getQueryData(serviceKeys.detail("service-1"))).toBeUndefined();
  }
);

it("waits for identity resolution before reading owner-sensitive services", async () => {
  session.loading = true;
  function Probe() {
    useCreatorServices({ creatorId: "alice" });
    useCreatorService("service-1");
    return null;
  }
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  await act(async () => render());
  expect(request).not.toHaveBeenCalled();
  session.loading = false;
  request.mockResolvedValue(Response.json({ items: [], nextCursor: null }));
  await act(async () => render());
  expect(request).toHaveBeenCalledTimes(2);
});
