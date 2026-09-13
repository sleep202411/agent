// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpProductionStage } from "./ip-production-stage";
import { api } from "@/src/lib/api";
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("does not retain another IP's stage and cancels its pending read", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  const render = (id: string) =>
    root.render(
      <QueryClientProvider client={client}>
        <IpProductionStage ipId={id} />
      </QueryClientProvider>
    );
  try {
    await act(async () => render("a"));
    const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
    await act(async () => render("b"));
    expect(signal?.aborted).toBe(true);
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/ip-commerce/ips/b/production-stage",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(host.textContent).toContain("loading");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
