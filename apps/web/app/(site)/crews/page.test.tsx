import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
const navigation = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
const mine = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        founded: Array<{ id: string; name: string; createdAt: string }>;
        joined: Array<{ id: string; name: string; createdAt: string }>;
      },
  isPending: false,
  isError: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/env", () => ({ env: { SITE_REGION: "sg" } }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => session }));
vi.mock("@/src/hooks/use-kyc", () => ({ useKycAuthStatus: () => ({}) }));
vi.mock("./_hooks/use-crew", () => ({ useCrewList: () => feed, useMyCrews: () => mine }));
vi.mock("./_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (value: string) => value,
}));
vi.mock("./_components/crew-workspace", () => ({
  CrewWorkspace: ({ id }: { id: string }) => <div data-workspace={id}>Private Crew</div>,
}));
vi.mock("./_components/create-crew-dialog", () => ({ CreateCrewDialog: () => null }));
vi.mock("./_components/positions-tab", () => ({ PositionsTab: () => null }));
vi.mock("@/app/_components/kyc-gate-dialog", () => ({ KycGateDialog: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => {
  navigation.search = "";
  session.user = null;
  mine.data = undefined;
  mine.isError = false;
  mine.error = null;
});
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

it("moves the membership list into My Crews and opens the selected workspace", () => {
  session.user = { id: "owner" };
  navigation.search = "view=mine";
  const crew = { id: "mine", name: "Private Crew", createdAt: "2026-01-01" };
  mine.data = { founded: [crew], joined: [crew] };
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<CrewsPage />));
  expect(container.querySelector("aside")).toBeNull();
  expect(container.textContent).not.toContain("Loaded Crew");
  expect(container.querySelector("[data-workspace=mine]")).not.toBeNull();
  mine.isError = true;
  mine.error = new Error("Membership refresh failed");
  act(() => root.render(<CrewsPage />));
  expect(container.textContent).toContain("Private Crew");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Membership refresh failed"
  );
  session.user = null;
  act(() => root.render(<CrewsPage />));
  expect(container.textContent).not.toContain("Private Crew");
  expect(container.textContent).toContain("myCrewsSignIn");
});
it("preserves other URL filters when selecting My Crews", () => {
  navigation.search = "from=invite";
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<CrewsPage />));
  const tab = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "myCrewsTitle"
  )!;
  act(() => tab.click());
  expect(navigation.replace).toHaveBeenCalledWith("?from=invite&view=mine", { scroll: false });
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/en-US/crews/tasks");
});
