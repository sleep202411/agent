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
async function render(enabled: boolean) {
  await act(async () =>
    root.render(
      <QuotaProvider enabled={enabled}>
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
