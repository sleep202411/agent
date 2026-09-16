import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuotaClientHandlers } from "./quota-client";
const mock = vi.hoisted(() => ({ handlers: [] as QuotaClientHandlers[] }));
vi.mock("./quota-client", () => ({
  openQuotaClient: (handlers: QuotaClientHandlers) => {
    mock.handlers.push(handlers);
    return { close: vi.fn(), isOpen: true };
  },
}));
import { QuotaProvider, useQuotaContext } from "./quota-provider";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let latest: ReturnType<typeof useQuotaContext>;
const reads: { resolve: (response: Response) => void; signal?: AbortSignal }[] = [];
function Probe() {
  const value = useQuotaContext();
  useLayoutEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const response = (tier: string) =>
  Response.json({
    code: 200,
    data: { tier, dimensions: {}, chatPerMinute: { limit: 1, remaining: 1, resetAt: "" } },
  });
beforeEach(() => {
  reads.length = 0;
  mock.handlers.length = 0;
  root = createRoot(document.createElement("div"));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          reads.push({ resolve, signal: init.signal ?? undefined });
        })
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
async function render(enabled: boolean, viewerId?: string) {
  await act(async () =>
    root.render(
      <QuotaProvider enabled={enabled} {...{ viewerId }}>
        <Probe />
      </QuotaProvider>
    )
  );
}
it("does not restore quota after disabling the provider", async () => {
  await render(true);
  await render(false);
  await act(async () => reads[0]!.resolve(response("old")));
  expect(latest.peek).toBeNull();
  expect(reads[0]!.signal?.aborted).toBe(true);
});
it("replaces reads and rejects retained actions when the enabled viewer changes", async () => {
  await render(true, "first");
  const retained = latest.refresh;
  await render(true, "second");
  expect(reads[0]!.signal?.aborted).toBe(true);
  expect(reads).toHaveLength(2);
  await act(async () => retained());
  expect(reads).toHaveLength(2);
  await act(async () => reads[0]!.resolve(response("first")));
  expect(latest.peek).toBeNull();
  await act(async () => reads[1]!.resolve(response("second")));
  expect(latest.peek?.tier).toBe("second");
});
it("ignores old subscription events after enabled viewer replacement", async () => {
  await render(true, "first");
  const old = mock.handlers[0]!;
  await render(true, "second");
  act(() => {
    old.onTerminate?.("expired", 4001);
    old.onReconnected?.();
  });
  expect(latest.terminated).toBeNull();
  expect(latest.reconnectAttempts).toBe(0);
  expect(reads).toHaveLength(2);
});
it("keeps the current read and subscription for the same viewer", async () => {
  await render(true, "same");
  await render(true, "same");
  expect(reads).toHaveLength(1);
  expect(mock.handlers).toHaveLength(1);
  expect(reads[0]!.signal?.aborted).toBe(false);
});
it("preserves the newer refresh when old responses finish later", async () => {
  await render(true);
  act(() => {
    void latest.refresh();
  });
  await act(async () => reads[1]!.resolve(response("new")));
  await act(async () => reads[0]!.resolve(response("old")));
  expect(latest.peek?.tier).toBe("new");
});
it("rejects retained refresh callbacks after disabling", async () => {
  await render(true);
  const oldRefresh = latest.refresh;
  await render(false);
  act(() => {
    void oldRefresh();
  });
  expect(reads).toHaveLength(1);
});
it("clears abandoned termination state when re-enabled", async () => {
  await render(true);
  act(() => mock.handlers[0]!.onTerminate?.("expired", 4001));
  await render(false);
  await render(true);
  expect(latest.terminated).toBeNull();
});
it("retains loaded quota after active failure and permits retry", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await render(true);
    await act(async () => reads[0]!.resolve(response("loaded")));
    act(() => {
      void latest.refresh();
    });
    await act(async () => reads[1]!.resolve(new Response(null, { status: 503 })));
    expect(latest.peek?.tier).toBe("loaded");
    expect(latest.loading).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    act(() => {
      void latest.refresh();
    });
    await act(async () => reads[2]!.resolve(response("retried")));
    expect(latest.peek?.tier).toBe("retried");
  } finally {
    warn.mockRestore();
  }
});
it("keeps replacement loading state when an abandoned request completes", async () => {
  await render(true);
  await render(false);
  await render(true);
  await act(async () => reads[0]!.resolve(response("abandoned")));
  expect(latest.loading).toBe(true);
  expect(latest.peek).toBeNull();
  await act(async () => reads[1]!.resolve(response("current")));
  expect(latest.loading).toBe(false);
  expect(latest.peek?.tier).toBe("current");
});
