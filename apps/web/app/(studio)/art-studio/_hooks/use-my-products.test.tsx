import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a" as string | null, post: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: s.user ? { id: s.user } : null }),
}));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
import { useMyProducts } from "./use-my-products";
let root: Root;
let client: QueryClient;
let value: ReturnType<typeof useMyProducts>;
function View() {
  const current = useMyProducts();
  useLayoutEffect(() => {
    value = current;
  });
  return null;
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    )
  );
  await settle();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.post.mockReset().mockResolvedValue({ list: [{ id: "a" }], totalCount: 1 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("does not reuse another viewer's recent projects and aborts abandoned requests", async () => {
  await render();
  expect(value.products[0].id).toBe("a");
  s.user = "b";
  s.post.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(value.products).toEqual([]);
  const signal = s.post.mock.calls.at(-1)![1].signal;
  s.user = null;
  await render();
  expect(signal.aborted).toBe(true);
  expect(s.post).toHaveBeenCalledTimes(2);
});
it("preserves loaded products after refresh failure and retries", async () => {
  await render();
  s.post.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await value.retry();
  });
  await settle();
  expect(value.isError).toBe(true);
  expect(value.products).toHaveLength(1);
  expect(value.error?.message).toBe("Offline");
  await act(async () => {
    await value.retry();
  });
  await settle();
  expect(value.isError).toBe(false);
});
