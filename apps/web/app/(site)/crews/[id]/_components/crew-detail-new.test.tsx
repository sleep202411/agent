import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewDetail } from "./crew-detail-new";
import type { CrewDTO } from "../../_hooks/use-crew";
import { CrewApiError } from "../../_hooks/api";
const query = vi.hoisted(() => ({
  data: [] as unknown[],
  isPending: false,
  isError: true,
  isFetching: false,
  hasNextPage: false,
  isFetchNextPageError: false,
  error: new Error("Positions unavailable"),
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/env", () => ({ env: {} }));
vi.mock("../../_hooks/use-crew", () => ({
  useCrewPositions: () => query,
  useCrewMembers: () => ({ data: [] }),
}));
vi.mock("../../_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => ({ isMember: false }),
}));
vi.mock("../../_hooks/use-users", () => ({ useUserDisplays: () => new Map() }));
vi.mock("../../_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (v: string) => v,
}));
vi.mock("../../_components/join-fan-community", () => ({ JoinFanCommunity: () => null }));
vi.mock("../../_components/apply-position-dialog", () => ({ ApplyPositionDialog: () => null }));
vi.mock("../workspace/_components/positions/position-card", () => ({
  PositionCard: () => <div>Loaded position</div>,
}));
const crew = { id: "crew", name: "Crew", createdAt: "2026-01-01", memberCount: 2 } as CrewDTO;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(query, {
    data: [],
    isPending: false,
    isError: true,
    isFetching: false,
    hasNextPage: false,
    isFetchNextPageError: false,
    error: new Error("Positions unavailable"),
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.clearAllMocks();
});
it("shows failure and retry rather than no jobs", () => {
  act(() => root.render(<CrewDetail crew={crew} />));
  expect(container.textContent).not.toContain("noJobsYet");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Positions unavailable");
  act(() => container.querySelector("button")!.click());
  expect(query.refetch).toHaveBeenCalledOnce();
  query.isFetching = true;
  act(() => root.render(<CrewDetail crew={crew} />));
  expect(container.querySelector("button")?.disabled).toBe(true);
});
it("shows loading rather than a false empty state", () => {
  query.isError = false;
  query.isPending = true;
  act(() => root.render(<CrewDetail crew={crew} />));
  expect(container.textContent).not.toContain("noJobsYet");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("loading");
  query.isPending = false;
  act(() => root.render(<CrewDetail crew={crew} />));
  expect(container.textContent).toContain("noJobsYet");
});
it.each([false, true])("retains cards and recovers pagination (invalid cursor: %s)", (invalid) => {
  query.data = [{ id: "position", targetCount: 1, recruitedCount: 0, status: "open" }];
  query.isFetchNextPageError = true;
  query.hasNextPage = true;
  if (invalid)
    query.error = new CrewApiError(400, {
      code: "CREW_POSITION_CURSOR_INVALID",
      message: "Restart",
    });
  act(() => root.render(<CrewDetail crew={crew} />));
  expect(container.textContent).toContain("Loaded position");
  act(() => container.querySelector("button")!.click());
  expect(invalid ? query.refetch : query.fetchNextPage).toHaveBeenCalledOnce();
  expect(invalid ? query.fetchNextPage : query.refetch).not.toHaveBeenCalled();
});
