// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TvEpisodeUnlock } from "./tv-episode-unlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  user: { id: "viewer" } as { id: string } | null,
  get: vi.fn(),
  post: vi.fn(),
  login: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: h.user }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.login }),
}));
vi.mock("@/components/payment/community-recharge-dialog", () => ({
  CommunityRechargeDialog: ({ open }: { open: boolean }) => (open ? <div data-recharge /> : null),
}));
vi.mock("@/components/payment/community-membership-dialog", () => ({
  CommunityMembershipDialog: ({ open }: { open: boolean }) =>
    open ? <div data-membership /> : null,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, params?: object) => `${key} ${JSON.stringify(params ?? {})}`,
}));
vi.mock("@/src/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
  ApiRequestError: class extends Error {},
}));
let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;
const quote = (access = "locked", targetType = "episode", balance = "1000") => ({
  episodes: [
    {
      id: "episode",
      access,
      price: { id: "rule", targetType, amount: "100", memberAmount: "80", unlocksAt: null },
    },
  ],
  wallet: { availableBalance: balance },
  entitlements: [],
});
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <TvEpisodeUnlock ipId="ip" episodeId="episode" />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function click() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>("button")!.click();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "viewer" };
  h.get.mockResolvedValue(quote());
  h.post.mockResolvedValue({});
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  container.remove();
});
describe("TV quick unlock", () => {
  it("shows the member price and charges only after an explicit click, then refreshes access", async () => {
    const invalidation = vi.spyOn(qc, "invalidateQueries");
    await render();
    expect(container.textContent).toContain('unlockEpisodePrice {"amount":"80"}');
    expect(h.post).not.toHaveBeenCalled();
    await click();
    expect(h.post).toHaveBeenCalledWith("/aurora/ip-commerce/purchases", {
      data: {
        ipId: "ip",
        episodeId: "episode",
        targetType: "episode",
        priceRuleId: "rule",
        idempotencyKey: expect.any(String),
      },
    });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["tv"] });
  });
  it("labels a package price and sends a package purchase without an episode ID", async () => {
    const packageQuote = quote("locked_bundle", "ip");
    h.get.mockResolvedValue({
      ...packageQuote,
      ip: { price: packageQuote.episodes[0].price },
      episodes: [{ id: "episode", access: "locked_bundle", price: null }],
    });
    await render();
    expect(container.textContent).toContain("unlockPackagePrice");
    await click();
    expect(h.post.mock.calls[0][1].data).toEqual({
      ipId: "ip",
      targetType: "ip",
      priceRuleId: "rule",
      idempotencyKey: expect.any(String),
    });
  });
  it("opens login for guests without reading an account quote or spending points", async () => {
    h.user = null;
    await render();
    await click();
    expect(h.login).toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });
  it("opens the existing recharge flow when the balance is insufficient", async () => {
    h.get.mockResolvedValue(quote("locked", "episode", "10"));
    await render();
    await click();
    expect(container.querySelector("[data-recharge]")).not.toBeNull();
    expect(h.post).not.toHaveBeenCalled();
  });
  it("does not resell a scheduled entitlement", async () => {
    h.get.mockResolvedValue({
      ...quote("pending_unlock_episode"),
      entitlements: [
        { targetType: "episode", episodeId: "episode", startsAt: "2099-01-01T00:00:00Z" },
      ],
    });
    await render();
    expect(container.textContent).toContain("unlockScheduled");
    expect(container.querySelector("button")).toBeNull();
    expect(h.post).not.toHaveBeenCalled();
  });
  it("uses the free member grant and preserves the membership gate", async () => {
    h.get.mockResolvedValue(quote("member_free", "episode", "0"));
    await render();
    await click();
    expect(h.post.mock.calls[0][1].data).toEqual({
      ipId: "ip",
      targetType: "ip",
      idempotencyKey: expect.any(String),
    });
    h.get.mockResolvedValue(quote("member_locked"));
    await act(async () => {
      await qc.invalidateQueries();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await click();
    expect(container.querySelector("[data-membership]")).not.toBeNull();
    expect(h.post).toHaveBeenCalledTimes(1);
  });
  it("deduplicates in-flight clicks and retains the request key after an ambiguous failure", async () => {
    let reject!: (e: Error) => void;
    h.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    await render();
    await click();
    await click();
    expect(h.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error("Connection interrupted"));
    });
    expect(container.textContent).toContain("Connection interrupted");
    await click();
    expect(h.post.mock.calls[1][1].data.idempotencyKey).toBe(
      h.post.mock.calls[0][1].data.idempotencyKey
    );
  });
});
