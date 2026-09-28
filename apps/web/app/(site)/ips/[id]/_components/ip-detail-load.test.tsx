// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/src/lib/api";
import { IpPublicDetail } from "./ip-public-detail";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  publicError: null as Error | null,
  creatorError: null as Error | null,
  fetching: false,
  publicRetry: vi.fn(),
  creatorRetry: vi.fn(),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useIpCommerceIp: () => ({
    isError: !!state.publicError,
    error: state.publicError,
    isFetching: state.fetching,
    refetch: state.publicRetry,
  }),
  useMyIpCommerceIp: () => ({
    isError: !!state.creatorError,
    error: state.creatorError,
    isFetching: state.fetching,
    refetch: state.creatorRetry,
  }),
  useIpAccess: () => ({}),
  useCommunityPointBalance: () => ({}),
  usePurchaseIpContent: () => ({}),
  useIpCommerceCollection: () => ({}),
  useSaveIpCommerceCollection: () => ({}),
  useRemoveIpCommerceCollection: () => ({}),
  useRecordIpView: () => ({}),
  useToggleIpEngagementLike: () => ({}),
}));
vi.mock("../_hooks/use-report-submission", () => ({ useReportSubmission: () => ({}) }));
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
  state.user = null;
  state.publicError = new ApiRequestError(503, "Service temporarily unavailable", 503);
  state.creatorError = null;
  state.fetching = false;
  state.publicRetry.mockReset();
  state.creatorRetry.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render() {
  act(() => root.render(<IpPublicDetail ipReference="ip" />));
}
const retry = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === "loadFailure.retry");
it("shows a retryable server failure instead of saying the public IP is unavailable", async () => {
  render();
  expect(host.textContent).not.toContain("notFound.title");
  expect(host.textContent).toContain("Service temporarily unavailable");
  expect(retry()).toBeDefined();
  await act(async () => retry()!.click());
  expect(state.publicRetry).toHaveBeenCalledOnce();
  expect(state.creatorRetry).not.toHaveBeenCalled();
  state.fetching = true;
  render();
  expect(retry()!.disabled).toBe(true);
});
it("offers recovery when a private IP's creator preview fails temporarily", async () => {
  state.user = { id: "owner" };
  state.publicError = new ApiRequestError(404, "Not found", 404);
  state.creatorError = new Error("Network offline");
  render();
  expect(host.textContent).toContain("Network offline");
  expect(host.textContent).not.toContain("notFound.title");
  await act(async () => retry()!.click());
  expect(state.publicRetry).toHaveBeenCalledOnce();
  expect(state.creatorRetry).toHaveBeenCalledOnce();
});
it("keeps the unavailable state for definitive unavailable public and creator responses", () => {
  state.user = { id: "viewer" };
  state.publicError = new ApiRequestError(404, "Not found", 404);
  state.creatorError = new ApiRequestError(403, "No preview access", 403);
  render();
  expect(host.textContent).toContain("notFound.title");
  expect(retry()).toBeUndefined();
});
