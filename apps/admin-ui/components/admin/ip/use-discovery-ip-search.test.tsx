// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { useDiscoveryIpSearch } from "./use-discovery-ip-search";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let result: ReturnType<typeof useDiscoveryIpSearch>;
const fetchMock = vi.fn();
function response(id: string) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data: { items: [{ id }] } }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function View({ search }: { search: string }) {
  const current = useDiscoveryIpSearch(search);
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
async function render(search = "first", session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  root ??= createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <View search={search} />
      </AdminSessionBoundary>
    )
  );
}
async function tick() {
  await act(async () => vi.advanceTimersByTime(250));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("cancels debounce and in-flight searches and ignores delayed replaced results", async () => {
  vi.useFakeTimers();
  const old = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response("new"));
  await render("unused");
  await render("old");
  await tick();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain("q=old");
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("new");
  expect(signal.aborted).toBe(true);
  await tick();
  await act(async () => old.resolve(response("old")));
  expect(result.items.map((item) => item.id)).toEqual(["new"]);
});
it("retains loaded options after failure and retries the current search", async () => {
  vi.useFakeTimers();
  fetchMock
    .mockResolvedValueOnce(response("loaded"))
    .mockRejectedValueOnce(new Error("Lookup unavailable"))
    .mockResolvedValueOnce(response("recovered"));
  await render();
  await tick();
  await render("second");
  await tick();
  expect(result.items[0].id).toBe("loaded");
  expect(result.error).toBe("Lookup unavailable");
  await act(async () => result.retry());
  await tick();
  expect(fetchMock.mock.calls[2][0]).toContain("q=second");
  expect(result.items[0].id).toBe("recovered");
  expect(result.error).toBeNull();
});
it("clears account-owned options and aborts a pending lookup on unmount", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(response("alice")).mockReturnValueOnce(new Promise(() => {}));
  await render();
  await tick();
  await render("first", "bob");
  expect(result.items).toEqual([]);
  await tick();
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await act(async () => root!.unmount());
  root = undefined;
  expect(signal.aborted).toBe(true);
});
