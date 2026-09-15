import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useKycAuthStatus, useCertifyQuery } from "./use-kyc";
import { useRecruitmentList } from "./use-recruitment";
const s = vi.hoisted(() => ({
  user: "a" as string | null,
  kyc: vi.fn(),
  recruit: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: s.user ? { id: s.user } : null }),
  userKeys: { info: ["user", "info"] },
}));
vi.mock("@/src/services/kyc", () => ({ getNeedAuth: s.kyc, certifyQuery: s.confirm }));
vi.mock("@/src/services/recruitment", () => ({ getRecruitmentList: s.recruit }));
let root: Root;
let client: QueryClient;
let status: ReturnType<typeof useKycAuthStatus>;
let confirm: ReturnType<typeof useCertifyQuery>;
function View() {
  const k = useKycAuthStatus();
  const c = useCertifyQuery();
  useRecruitmentList();
  useLayoutEffect(() => {
    status = k;
    confirm = c;
  });
  return null;
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.kyc.mockReset().mockResolvedValue({ needAuth: false });
  s.recruit.mockReset().mockResolvedValue([]);
  s.confirm.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("does not reuse another account's verification and cancels abandoned private reads", async () => {
  await render();
  expect(status.data?.needAuth).toBe(false);
  s.user = "b";
  s.kyc.mockImplementation(() => new Promise(() => {}));
  s.recruit.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(status.data).toBeUndefined();
  const signals = [s.kyc.mock.calls[1][0], s.recruit.mock.calls[1][1]] as AbortSignal[];
  s.user = null;
  await render();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(s.kyc).toHaveBeenCalledTimes(2);
});
it("does not refresh a replacement user's profile after delayed verification", async () => {
  let resolve!: (v: unknown) => void;
  s.confirm.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  let pending!: ReturnType<typeof confirm.mutateAsync>;
  await act(async () => {
    pending = confirm.mutateAsync("verification");
    await Promise.resolve();
  });
  s.user = "b";
  client.setQueryData(["user", "info"], { id: "b" });
  await render();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    resolve({ status: "T" });
    await pending;
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["kyc", "auth-status", "a"] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["user", "info"] });
});
