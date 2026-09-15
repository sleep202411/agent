// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  orderKeys,
  useOrders,
  useOrder,
  useSubmitOrder,
  useAcceptProposal,
  useAcceptOrder,
  useDeclineOrder,
  useDeliverOrder,
  useAcceptDelivery,
  useRequestRevision,
  useCancelOrder,
} from "./use-orders";
const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  session.id = "alice";
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
            const query = useOrders();
            return <div>{JSON.stringify(query.data)}</div>;
          }
        : function Detail() {
            const query = useOrder("order-1");
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
      mode === "list" ? { items: [{ id: "bob-order" }], nextCursor: null } : { id: "bob-order" };
    request.mockResolvedValueOnce(Response.json(bob));
    await act(async () => render());
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(
        Response.json(
          mode === "list"
            ? { items: [{ id: "alice-order" }], nextCursor: null }
            : { id: "alice-order" }
        )
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("bob-order");
    expect(container.textContent).not.toContain("alice-order");
    session.id = null;
    await act(async () => render());
    expect(container.textContent).not.toContain("bob-order");
    expect(request).toHaveBeenCalledTimes(2);
  }
);

const mutations = {
  useSubmitOrder,
  useAcceptProposal,
  useAcceptOrder,
  useDeclineOrder,
  useDeliverOrder,
  useAcceptDelivery,
  useRequestRevision,
  useCancelOrder,
};
it.each(Object.keys(mutations) as Array<keyof typeof mutations>)(
  "keeps a delayed %s result in the initiating account cache",
  async (name) => {
    const useOrderMutation = mutations[name];
    function Probe() {
      const mutation = useOrderMutation();
      return (
        <button
          onClick={() =>
            mutation.mutate({
              id: "order-1",
              reason: "fixture",
              conversationId: "conversation",
              messageId: "message",
              serviceId: "service",
              packageTier: "basic",
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
    const replacement = { id: "order-1", note: "Bob cache" };
    client.setQueryData(orderKeys.detail("order-1", "bob"), replacement);
    await act(async () => render());
    const result = { id: "order-1", note: "Alice result" };
    await act(async () => finish(Response.json(result)));
    expect(client.getQueryData(orderKeys.detail("order-1", "alice"))).toEqual(result);
    expect(client.getQueryData(orderKeys.detail("order-1", "bob"))).toEqual(replacement);
    expect(client.getQueryData(orderKeys.detail("order-1"))).toBeUndefined();
  }
);
