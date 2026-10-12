import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useLogout } from "./use-logout";

const mocks = vi.hoisted(() => ({ logout: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/src/lib/auth/api", () => ({ logout: mocks.logout }));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US" }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn(), reset: vi.fn() } }));
vi.mock("@/src/hooks/use-user", () => ({
  userKeys: { info: ["user", "info"], credits: ["user", "credits"] },
}));
vi.mock("@/src/hooks/use-kyc", () => ({ kycKeys: { authStatus: ["kyc", "auth-status"] } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  document.cookie = "satoken=; path=/; max-age=0";
  vi.resetAllMocks();
});
it.each(["failure", "pending"])(
  "clears local credentials and all account balances despite server %s",
  async (mode) => {
    document.cookie = "satoken=current-session; path=/";
    let sentCookie = "";
    mocks.logout.mockImplementation(() => {
      sentCookie = document.cookie;
      return mode === "failure" ? Promise.reject(new Error("offline")) : new Promise(() => {});
    });
    client = new QueryClient();
    client.setQueryData(["user", "info"], { id: "alice" });
    for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
      client.setQueryData(["user", "info", locale], { id: "alice" });
    }
    client.setQueryData(["user", "credits", "alice"], 100);
    client.setQueryData(["user", "credits", "bob"], 200);
    client.setQueryData(["user-levels", "apply", "mine", 0, "en-US", "alice"], [{ levelId: 3 }]);
    client.setQueryData(["kyc", "auth-status"], { verified: true });
    root = createRoot(document.createElement("div"));
    let logout!: () => void;
    function Probe() {
      logout = useLogout();
      return null;
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
    await act(async () => logout());
    expect(sentCookie).toContain("satoken=current-session");
    expect(document.cookie).not.toContain("satoken=");
    expect(client.getQueryData(["user", "info"])).toBeNull();
    for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
      expect(client.getQueryData(["user", "info", locale])).toBeNull();
    }
    expect(client.getQueriesData({ queryKey: ["user", "credits"] })).toEqual([]);
    expect(client.getQueryData(["kyc", "auth-status"])).toBeUndefined();
    expect(client.getQueriesData({ queryKey: ["user-levels", "apply"] })).toEqual([]);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  }
);
