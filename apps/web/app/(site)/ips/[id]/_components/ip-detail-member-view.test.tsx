// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpPublicDetail } from "./ip-public-detail";
const state = vi.hoisted(() => ({
  user: { id: "viewer" } as { id: string } | null,
  member: undefined as boolean | undefined,
  fullMedia: true,
  access: "owned_ip",
  priced: false,
  balance: "1000",
  purchase: vi.fn(),
  signal: vi.fn(),
  player: null as null | { src: string; onFirstPlay?: () => void },
}));
vi.mock("@/src/lib/ip-commerce/api", async (original) => ({
  ...(await original<object>()),
  recordMemberView: (...args: unknown[]) => state.signal(...args),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({
    open: vi.fn(),
    close: vi.fn(),
    isOpen: false,
  }),
  AuthDialogProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/media/video-player", () => ({
  VideoPlayer: (props: { src: string; onFirstPlay?: () => void }) => {
    state.player = props;
    return null;
  },
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useIpCommerceIp: () => ({
    data: {
      ip: {
        id: "ip",
        roomNumber: "100001",
        title: "Published IP",
        summary: "Summary",
        genres: [],
        contributors: [],
        campaigns: [],
        tags: [],
        status: "published",
        listingVisibility: "public",
        sourceLocale: "en-US",
        createdById: "creator",
        trailerAsset: { url: "https://cdn.test/trailer.mp4" },
        price: state.priced
          ? { id: "rule", targetType: "ip", amount: "299", currency: "community_point" }
          : null,
        episodes: [
          {
            id: "episode",
            episodeNo: 1,
            title: "Full episode",
            status: "published",
            mediaAsset: state.fullMedia ? { url: "https://cdn.test/full.mp4" } : null,
            trailerAsset: { url: "https://cdn.test/trailer.mp4" },
            price: null,
          },
        ],
      },
    },
  }),
  useMyIpCommerceIp: () => ({}),
  useIpAccess: () =>
    state.member === undefined
      ? { isLoading: true }
      : {
          data: {
            member: state.member,
            episodes: [{ id: "episode", access: state.access }],
            entitlements: [],
          },
        },
  useCommunityPointBalance: () => ({ balance: state.balance, isLoading: false }),
  usePurchaseIpContent: () => ({ mutateAsync: state.purchase }),
  useIpCommerceCollection: () => ({}),
  useSaveIpCommerceCollection: () => ({}),
  useRemoveIpCommerceCollection: () => ({}),
  useRecordIpView: () => ({ mutate: () => {} }),
  useToggleIpEngagementLike: () => ({}),
}));
vi.mock("@/src/lib/axon", () => ({ axonViewItem: () => {} }));
vi.mock("../_hooks/use-report-submission", () => ({ useReportSubmission: () => ({}) }));
vi.mock("./ip-engagement-actions", () => ({ IpEngagementActions: () => null }));
vi.mock("../../_components/channel-submissions", () => ({ ChannelSubmissions: () => null }));
vi.mock("../../_components/ip-fan-community", () => ({ IpFanCommunity: () => null }));
vi.mock("../../_components/episode-feedback", () => ({ EpisodeFeedback: () => null }));
vi.mock("../../_components/ip-production-stage", () => ({ IpProductionStage: () => null }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ useUserDisplays: () => new Map() }));
vi.mock("@/components/payment/community-recharge-dialog", () => ({
  CommunityRechargeDialog: ({ open }: { open: boolean }) => (open ? <div data-recharge /> : null),
}));
vi.mock("@/components/payment/community-membership-dialog", () => ({
  CommunityMembershipDialog: () => null,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.user = { id: "viewer" };
  state.member = undefined;
  state.fullMedia = true;
  state.access = "owned_ip";
  state.priced = false;
  state.balance = "1000";
  state.purchase.mockReset().mockResolvedValue({});
  state.player = null;
  state.signal.mockReset().mockResolvedValue({ recorded: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={testQueryClient}>
        <IpPublicDetail ipReference="ip" />
      </QueryClientProvider>
    )
  );
}
it("withholds full media while access is pending even when no price is present", async () => {
  render();
  expect(state.player).toBeNull();
  expect(state.signal).not.toHaveBeenCalled();
});
it("does not substitute a trailer for an unavailable full episode", async () => {
  state.member = true;
  state.fullMedia = false;
  render();
  expect(state.player).toBeNull();
  await act(async () => state.player?.onFirstPlay?.());
  expect(state.signal).not.toHaveBeenCalled();
});
it("does not send an authenticated member-view request for a guest", async () => {
  state.user = null;
  render();
  await act(async () => state.player?.onFirstPlay?.());
  expect(state.signal).not.toHaveBeenCalled();
});

it("still signals normal member full playback and tolerates reporting failure", async () => {
  state.member = true;
  state.signal.mockRejectedValueOnce(new Error("Reporting unavailable"));
  render();
  expect(state.player?.src).toBe("https://cdn.test/full.mp4");
  await act(async () => state.player?.onFirstPlay?.());
  expect(state.signal).toHaveBeenCalledWith({ ipId: "ip", episodeId: "episode" });
  expect(host.textContent).toContain("Full episode");
});

it("keeps locked content hidden, offers a package purchase, and plays only after access is granted", async () => {
  state.member = false;
  state.access = "locked_bundle";
  state.priced = true;
  render();
  expect(state.player).toBeNull();
  expect(state.purchase).not.toHaveBeenCalled();
  const button = Array.from(host.querySelectorAll("button")).find((item) =>
    item.textContent?.startsWith("commerce.purchase ·")
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(state.purchase).toHaveBeenCalledWith(
    expect.objectContaining({ ipId: "ip", targetType: "ip", priceRuleId: "rule" })
  );
  expect(state.player).toBeNull();
  state.access = "owned_ip";
  render();
  expect(state.player?.src).toBe("https://cdn.test/full.mp4");
});
it("plays the trailer only when explicitly selected while the episode is locked", () => {
  state.member = false;
  state.access = "locked_bundle";
  render();
  expect(state.player).toBeNull();
  const trailer = Array.from(host.querySelectorAll("button")).find((item) =>
    item.textContent?.includes("episodes.trailer")
  );
  expect(trailer).toBeDefined();
  act(() => trailer!.click());
  expect(state.player?.src).toBe("https://cdn.test/trailer.mp4");
  expect(state.purchase).not.toHaveBeenCalled();
});

it("keeps the purchase entry visible with low balance and opens recharge without spending", async () => {
  state.member = false;
  state.access = "locked_bundle";
  state.priced = true;
  state.balance = "0";
  render();
  const button = Array.from(host.querySelectorAll("button")).find((item) =>
    item.textContent?.startsWith("commerce.purchase ·")
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(host.querySelector("[data-recharge]")).not.toBeNull();
  expect(state.purchase).not.toHaveBeenCalled();
  expect(state.player).toBeNull();
});
