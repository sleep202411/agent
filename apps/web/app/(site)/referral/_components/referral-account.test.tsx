import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ReferralDashboardPage } from "./referral-dashboard";
import { EMPTY_REFERRAL_DASHBOARD } from "../_hooks/api";

const state = vi.hoisted(() => ({ account: "A" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.account ? { id: state.account } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let requests: Array<{ resolve: (value: Response) => void; init?: RequestInit }>;
function reply(code: string) {
  return new Response(
    JSON.stringify({
      code: 200,
      data: {
        ...EMPTY_REFERRAL_DASHBOARD,
        programAvailable: true,
        inviteCode: code,
        inviteUrl: `https://example.test/${code}`,
      },
    })
  );
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ReferralDashboardPage />
      </QueryClientProvider>
    );
  });
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
beforeEach(() => {
  state.account = "A";
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => requests.push({ resolve, init }))
    )
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
it("does not display the previous account's cached invitation after switching accounts", async () => {
  await render();
  requests[0].resolve(reply("INVITE-A"));
  await flush();
  expect(host.textContent).toContain("INVITE-A");
  state.account = "B";
  await render();
  expect(host.textContent).not.toContain("INVITE-A");
  expect(requests).toHaveLength(2);
  requests[1].resolve(reply("INVITE-B"));
  await flush();
  expect(host.textContent).toContain("INVITE-B");
});
it("cancels an abandoned read and ignores its late response", async () => {
  await render();
  state.account = "B";
  await render();
  expect(requests[0].init?.signal?.aborted).toBe(true);
  requests[0].resolve(reply("INVITE-A"));
  await flush();
  expect(host.textContent).not.toContain("INVITE-A");
  requests[1].resolve(reply("INVITE-B"));
  await flush();
  expect(host.textContent).toContain("INVITE-B");
});
it("makes no private request while signed out and hides data on logout", async () => {
  state.account = null;
  await render();
  expect(requests).toHaveLength(0);
  state.account = "A";
  await render();
  requests[0].resolve(reply("INVITE-A"));
  await flush();
  state.account = null;
  await render();
  expect(host.textContent).not.toContain("INVITE-A");
});
it.each([200, 500])("keeps an old account's claim completion isolated (%s)", async (status) => {
  await render();
  requests[0].resolve(
    new Response(
      JSON.stringify({
        code: 200,
        data: {
          ...EMPTY_REFERRAL_DASHBOARD,
          programAvailable: true,
          inviteCode: "INVITE-A",
          rewards: [
            {
              id: "reward-A",
              title: "Reward A",
              payoutType: "points_compute",
              amountMinor: "1",
              days: 0,
              currency: null,
              status: "accrued",
              claimable: true,
            },
          ],
        },
      })
    )
  );
  await flush();
  const claim = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "claim")!;
  await act(async () => claim.click());
  expect(requests).toHaveLength(2);
  state.account = "B";
  await render();
  expect(requests).toHaveLength(3);
  requests[2].resolve(reply("INVITE-B"));
  await flush();
  requests[1].resolve(
    new Response(
      JSON.stringify(
        status === 200
          ? { code: 200, data: { status: "paid_out" } }
          : { message: "Account A claim failed" }
      ),
      { status }
    )
  );
  await flush();
  expect(host.textContent).toContain("INVITE-B");
  expect(host.textContent).not.toContain("Account A claim failed");
  expect(requests).toHaveLength(3);
});
