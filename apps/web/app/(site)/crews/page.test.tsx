import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CrewsPage from "./page";

const feed = vi.hoisted(() => ({
  data: {
    pages: [{ items: [{ id: "crew", name: "Loaded Crew", createdAt: "2026-01-01" }] }],
  } as unknown,
  isLoading: false,
  isError: true,
  isFetching: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  hasNextPage: true,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/env", () => ({ env: { SITE_REGION: "sg" } }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/src/hooks/use-kyc", () => ({ useKycAuthStatus: () => ({}) }));
vi.mock("./_hooks/use-crew", () => ({ useCrewList: () => feed, useMyCrews: () => ({}) }));
vi.mock("./_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (value: string) => value,
}));
vi.mock("./_components/create-crew-dialog", () => ({ CreateCrewDialog: () => null }));
vi.mock("./_components/positions-tab", () => ({ PositionsTab: () => null }));
vi.mock("@/app/_components/kyc-gate-dialog", () => ({ KycGateDialog: () => null }));
vi.mock("./_components/crew-switcher-rail", () => ({
  CrewSwitcherRailView: () => null,
  mergeCrewMemberships: () => [],
  shouldShowCrewSwitcherRail: () => false,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  vi.clearAllMocks();
});
it.each(["initial", "refresh", "next"])("offers the correct recovery for a %s failure", (kind) => {
  feed.data =
    kind === "initial"
      ? undefined
      : { pages: [{ items: [{ id: "crew", name: "Loaded Crew", createdAt: "2026-01-01" }] }] };
  feed.isFetchNextPageError = kind === "next";
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<CrewsPage />));
  expect(container.textContent?.includes("Loaded Crew")).toBe(kind !== "initial");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("loadFailed");
  const retry = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "retry"
  )!;
  act(() => retry.click());
  expect(feed.fetchNextPage).toHaveBeenCalledTimes(kind === "next" ? 1 : 0);
  expect(feed.refetch).toHaveBeenCalledTimes(kind === "next" ? 0 : 1);
});
