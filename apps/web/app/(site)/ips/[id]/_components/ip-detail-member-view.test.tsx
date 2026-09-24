// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpPublicDetail } from "./ip-public-detail";
const state = vi.hoisted(() => ({
  user: { id: "viewer" } as { id: string } | null,
  member: undefined as boolean | undefined,
  fullMedia: true,
  signal: vi.fn(),
  player: null as null | { src: string; onFirstPlay?: () => void },
}));
vi.mock("@/src/lib/ip-commerce/api", async (original) => ({
  ...(await original<object>()),
  recordMemberView: (...args: unknown[]) => state.signal(...args),
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
        price: null,
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
            episodes: [{ id: "episode", access: "owned_ip" }],
            entitlements: [],
          },
        },
  useCommunityPointBalance: () => ({}),
  usePurchaseIpContent: () => ({}),
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
  CommunityRechargeDialog: () => null,
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
  state.player = null;
  state.signal.mockReset().mockResolvedValue({ recorded: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render() {
  act(() => root.render(<IpPublicDetail ipReference="ip" />));
}
it("reports available full media even while the membership query is pending", async () => {
  render();
  expect(state.player?.src).toBe("https://cdn.test/full.mp4");
  await act(async () => state.player?.onFirstPlay?.());
  expect(state.signal).toHaveBeenCalledWith({ ipId: "ip", episodeId: "episode" });
});
it("does not report a fallback trailer as full-episode member playback", async () => {
  state.member = true;
  state.fullMedia = false;
  render();
  expect(state.player?.src).toBe("https://cdn.test/trailer.mp4");
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
