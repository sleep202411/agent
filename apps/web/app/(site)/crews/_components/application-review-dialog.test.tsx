import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationReviewDialog } from "./application-review-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  missingApplication: false,
  missingPosition: false,
  morePositions: false,
  failed: "" as string,
  nextPageError: false,
  appRetry: vi.fn(),
  positionsRetry: vi.fn(),
  nextPage: vi.fn(),
  crewRetry: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CURRENCY_SYMBOLS: { USD: "$", CNY: "¥" },
  ZERO_DECIMAL_CURRENCIES: new Set(),
  CrewApiError: class extends Error {},
  useApproveApplication: () => ({ mutate: state.approve, isPending: false }),
  useRejectApplication: () => ({ mutate: state.reject, isPending: false }),
  useCrewApplication: (_crew: string, id: string) => ({
    data: state.missingApplication
      ? undefined
      : {
          id,
          positionId: "position",
          applicantId: "12",
          status: "pending",
          message: "Application " + id,
          createdAt: "2026-09-12T00:00:00Z",
        },
    isLoading: false,
    isError: state.failed === "application",
    error: new Error("Application unavailable"),
    refetch: state.appRetry,
  }),
  useCrewPositions: () => ({
    data: state.missingPosition
      ? []
      : [
          {
            id: "position",
            positionType: "director",
            workMode: "remote",
            experienceLevel: "any",
            salary: { negotiable: true },
            targetCount: 1,
            recruitedCount: 0,
          },
        ],
    isError: state.failed === "positions",
    error: new Error("Positions unavailable"),
    refetch: state.positionsRetry,
    hasNextPage: state.morePositions,
    isFetchNextPageError: state.nextPageError,
    fetchNextPage: state.nextPage,
  }),
  useCrewDetail: () => ({
    data: { name: "Crew" },
    isError: state.failed === "crew",
    error: new Error("Crew unavailable"),
    refetch: state.crewRetry,
  }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: () => "Applicant",
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Part,
    DialogBody: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogFooter: Part,
    DialogHero: () => null,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  state.missingApplication = false;
  state.missingPosition = false;
  state.morePositions = false;
  state.failed = "";
  state.nextPageError = false;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(applicationId: string | null = "application", crewId = "crew") {
  await act(async () =>
    root.render(
      <ApplicationReviewDialog
        applicationId={applicationId}
        onClose={state.close}
        crewId={crewId}
      />
    )
  );
}
async function decide(first = "approve") {
  await act(async () => {
    const buttons = [...container.querySelectorAll("button")];
    buttons.find((b) => b.textContent === first)!.click();
    buttons.find((b) => b.textContent === "approve")!.click();
    buttons.find((b) => b.textContent === "reject")!.click();
  });
}
it.each(["approve", "reject"])(
  "serializes %s against repeated and competing decisions, allowing retry",
  async (first) => {
    await render();
    await decide(first);
    const selected = first === "approve" ? state.approve : state.reject;
    const other = first === "approve" ? state.reject : state.approve;
    expect(selected).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    const handlers = selected.mock.calls[0]?.[1];
    await act(async () => {
      handlers.onError(new Error("Specific failure"));
      handlers.onSettled?.();
    });
    expect(state.error).toHaveBeenCalledWith("Specific failure");
    await decide(first);
    expect(selected).toHaveBeenCalledTimes(2);
  }
);
it.each(["account", "crew", "application", "close"])(
  "ignores decisions from an older %s session",
  async (change) => {
    await render();
    await decide();
    const handlers = state.approve.mock.calls[0]?.[1];
    if (change === "account") state.account = "bob";
    if (change === "close") await render(null);
    await render(
      change === "application" ? "next" : "application",
      change === "crew" ? "next-crew" : "crew"
    );
    await decide("reject");
    await act(async () => {
      handlers.onSuccess({});
      handlers.onError(new Error("Old error"));
      handlers.onSettled?.();
    });
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    await decide("reject");
    expect(state.reject).toHaveBeenCalledTimes(1);
  }
);

it("shows the application load error with retry instead of claiming it is missing", async () => {
  state.missingApplication = true;
  state.failed = "application";
  await render();
  expect(container.textContent).toContain("Application unavailable");
  expect(container.textContent).not.toContain("reviewDialogNotFound");
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
  );
  expect(state.appRetry).toHaveBeenCalledTimes(1);
});
it.each(["application", "positions", "crew"])(
  "retains loaded details and pauses decisions during %s refresh errors",
  async (failed) => {
    await render();
    state.failed = failed;
    await render();
    expect(container.textContent).toContain("Application application");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await decide();
    expect(state.approve).not.toHaveBeenCalled();
    expect(state.reject).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
    );
    const retry =
      failed === "application"
        ? state.appRetry
        : failed === "positions"
          ? state.positionsRetry
          : state.crewRetry;
    expect(retry).toHaveBeenCalledTimes(1);
    state.failed = "";
    await render();
    await decide();
    expect(state.approve).toHaveBeenCalledTimes(1);
  }
);
it("waits for position pagination and retries the failed page", async () => {
  state.missingPosition = true;
  state.morePositions = true;
  await render();
  expect(container.textContent).toContain("reviewDialogLoading");
  expect(container.textContent).not.toContain("reviewDialogNotFound");
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "approve")).toBe(
    false
  );
  state.failed = "positions";
  state.nextPageError = true;
  await render();
  expect(container.textContent).toContain("Positions unavailable");
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
  );
  expect(state.nextPage).toHaveBeenCalledTimes(1);
  expect(state.positionsRetry).not.toHaveBeenCalled();
  state.missingPosition = false;
  state.failed = "";
  state.morePositions = false;
  await render();
  expect(container.textContent).toContain("Application application");
});
