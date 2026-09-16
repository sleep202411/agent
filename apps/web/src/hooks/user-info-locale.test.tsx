// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useUserInfo } from "./use-user";
const mocks = vi.hoisted(() => ({ locale: "en-US", get: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => mocks.locale }));
vi.mock("@/src/lib/api", () => ({ api: { get: mocks.get } }));
it("cancels replaced locale reads and retains the new profile's certification labels", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  let finish!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  function Probe() {
    const query = useUserInfo();
    return <div>{JSON.stringify(query.data)}</div>;
  }
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  try {
    await act(async () => render());
    const signal = mocks.get.mock.calls[0]![1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    mocks.locale = "zh-CN";
    mocks.get.mockResolvedValueOnce({ info: { id: "alice" }, level: [{ name: "当前等级" }] });
    await act(async () => render());
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ info: { id: "alice" }, level: [{ name: "Old level" }] }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("当前等级");
    expect(container.textContent).not.toContain("Old level");
    expect(client.getQueryData(["user", "info", "en-US"])).toBeUndefined();
    expect(mocks.get.mock.calls[1]![1].raw).toBe(true);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
