import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTagList } from "./use-tag-list";
const s = vi.hoisted(() => ({ user: "a", locale: "en-US", get: vi.fn() }));
vi.mock("./use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => s.locale }));

let root: Root;
let client: QueryClient;
let latest: ReturnType<typeof useTagList>;
function View() {
  const result = useTagList();
  useLayoutEffect(() => {
    latest = result;
  });
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "fetch",
    async (...args: unknown[]) =>
      new Response(JSON.stringify(await s.get(...args)), { status: 200 })
  );
  s.user = "a";
  s.locale = "en-US";
  s.get.mockReset().mockResolvedValue({ all: { 1: "Drama" } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("retains loaded tags after failure and retries without inventing empty success", async () => {
  await render();
  expect(latest.data).toEqual([{ id: 1, name: "Drama" }]);
  expect(s.get).toHaveBeenCalledWith(
    "/vedio/type/tag/list",
    expect.objectContaining({ headers: expect.objectContaining({ "accept-language": "en-US" }) })
  );
  s.get.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await latest.refetch();
  });
  await render();
  expect(latest.isError).toBe(true);
  expect(latest.data).toEqual([{ id: 1, name: "Drama" }]);
  s.get.mockResolvedValue({ all: { 2: "Comedy" } });
  await act(async () => {
    await latest.refetch();
  });
  await render();
  expect(latest.data).toEqual([{ id: 2, name: "Comedy" }]);
});
it("isolates locale/account catalogs and aborts abandoned reads", async () => {
  await render();
  s.locale = "zh-CN";
  s.get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(latest.data).toBeUndefined();
  const signal = s.get.mock.calls[1][1].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  expect(s.get).toHaveBeenCalledTimes(3);
});

it("preserves the official empty result for unsuccessful HTTP responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await render();
  expect(latest.isError).toBe(false);
  expect(latest.data).toEqual([]);
});
