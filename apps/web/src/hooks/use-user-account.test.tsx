import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useCredits, useRefreshCredits, userKeys } from "./use-user";
const api = vi.hoisted(() => ({ credits: vi.fn() }));
vi.mock("@/src/services/user", () => ({
  getUserInfo: vi.fn(),
  getCredits: api.credits,
  updateUserInfo: vi.fn(),
  uploadAvatar: vi.fn(),
  uploadBanner: vi.fn(),
  getRecommendationCode: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function account(id: string | null) {
  await act(async () => {
    client.setQueryData(userKeys.info, id ? { id } : null);
  });
  await settle();
}
async function mount(id: string | null = "alice") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(userKeys.info, id ? { id } : null);
  root = createRoot(document.createElement("div"));
  let current!: {
    credits: ReturnType<typeof useCredits>;
    refresh: ReturnType<typeof useRefreshCredits>;
  };
  function Probe() {
    current = { credits: useCredits(), refresh: useRefreshCredits() };
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  );
  await settle();
  return () => current;
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});
it("does not fetch credits while signed out", async () => {
  const current = await mount(null);
  expect(api.credits).not.toHaveBeenCalled();
  expect(current().credits.data).toBeUndefined();
});
it("isolates balances on account changes and logout", async () => {
  api.credits.mockResolvedValueOnce(100).mockResolvedValueOnce(200);
  const current = await mount();
  expect(current().credits.data).toBe(100);
  await account("bob");
  expect(current().credits.data).toBe(200);
  await account(null);
  expect(current().credits.data).toBeUndefined();
});
it("ignores delayed previous-account balances", async () => {
  let finish!: (value: number) => void;
  api.credits
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(200);
  const current = await mount();
  await account("bob");
  await act(async () => finish(100));
  await settle();
  expect(current().credits.data).toBe(200);
});
it("keeps a delayed refresh helper tied to its original account", async () => {
  api.credits.mockResolvedValue(100);
  const current = await mount();
  const refresh = current().refresh;
  await account("bob");
  api.credits.mockClear();
  await act(async () => {
    await refresh();
  });
  expect(api.credits).not.toHaveBeenCalled();
  await account("alice");
  expect(api.credits).toHaveBeenCalledTimes(1);
});
