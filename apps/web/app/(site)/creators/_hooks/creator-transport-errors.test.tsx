// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useAcceptOrder, OrderApiError } from "./use-orders";
import { usePauseService, ServiceApiError } from "./use-creator-services";
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "alice" } }) }));
afterEach(() => vi.unstubAllGlobals());
for (const [kind, useAction, ErrorType] of [
  ["order", useAcceptOrder, OrderApiError],
  ["service", usePauseService, ServiceApiError],
] as const) {
  it.each([
    {
      body: "Upstream temporarily unavailable",
      message: "Upstream temporarily unavailable",
      parsed: "Upstream temporarily unavailable",
    },
    {
      body: '{"message":"Already changed"}',
      message: "Already changed",
      parsed: { message: "Already changed" },
    },
    { body: '"Retry later"', message: "Retry later", parsed: "Retry later" },
    { body: "", message: `${kind === "order" ? "Order" : "Service"} API error 503`, parsed: "" },
  ])(`retains ${kind} HTTP failure body: $body`, async ({ body, message, parsed }) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const response = new Response(body, { status: 503 });
    const read = vi.spyOn(response, "text");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const client = new QueryClient();
    const container = document.createElement("div");
    const root = createRoot(container);
    let failure: unknown;
    function Probe() {
      const mutation = useAction();
      return (
        <button
          onClick={() => {
            void mutation.mutateAsync({ id: "record-1" }).catch((error) => {
              failure = error;
            });
          }}
        >
          act
        </button>
      );
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      );
      await act(async () => container.querySelector("button")!.click());
      expect(failure).toBeInstanceOf(ErrorType);
      expect(failure).toMatchObject({ status: 503, message, body: parsed });
      expect(read).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });
}
