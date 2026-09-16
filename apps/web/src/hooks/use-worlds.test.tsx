import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorldsWithProducts } from "./use-worlds";
const s = vi.hoisted(() => ({ user: "a" as string | null, post: vi.fn() }));
vi.mock("./use-user", () => ({ useCurrentUser: () => ({ user: s.user ? { id: s.user } : null }) }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
let root: Root;
let client: QueryClient;
let state: ReturnType<typeof useWorldsWithProducts>;
function View() {
  const value = useWorldsWithProducts();
  useLayoutEffect(() => {
    state = value;
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
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.post
    .mockReset()
    .mockImplementation((url: string) =>
      Promise.resolve({ list: url.includes("list/worldproduct") ? [{ id: "p" }] : [{ id: "w" }] })
    );
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("isolates private world and product caches and cancels abandoned reads", async () => {
  await render();
  await settle();
  expect(state.totalProducts).toBe(1);
  s.user = "b";
  s.post.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(state.groups).toEqual([]);
  const signal = s.post.mock.calls.at(-1)![1].signal;
  s.user = null;
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.groups).toEqual([]);
  expect(s.post).toHaveBeenCalledTimes(3);
});
it("exposes product failure and retries without losing available worlds", async () => {
  s.post.mockImplementation((url: string) =>
    url.includes("list/worldproduct")
      ? Promise.reject(new Error("Products unavailable"))
      : Promise.resolve({ list: [{ id: "w" }] })
  );
  await render();
  await settle();
  expect(state.error?.message).toBe("Products unavailable");
  expect(state.worlds).toHaveLength(1);
  s.post.mockImplementation((url: string) =>
    Promise.resolve({ list: url.includes("list/worldproduct") ? [{ id: "p" }] : [{ id: "w" }] })
  );
  await act(async () => {
    await state.retry();
  });
  await settle();
  expect(state.totalProducts).toBe(1);
  expect(state.isError).toBe(false);
});
it("retains loaded products after a failed refresh", async () => {
  await render();
  await settle();
  s.post.mockRejectedValue(new Error("Offline"));
  await act(async () => {
    await client.invalidateQueries();
  });
  await settle();
  expect(state.totalProducts).toBe(1);
  expect(state.isError).toBe(true);
});
