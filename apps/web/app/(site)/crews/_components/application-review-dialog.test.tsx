import { CrewApiError as CursorApiError } from "@/app/(site)/crews/_hooks/api";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationReviewDialog } from "./application-review-dialog";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
vi.mock("./application-terms-panel", () => ({
  ApplicationTermsPanel: ({ onReady }: { onReady: (ready: boolean) => void }) => {
    const ready = state.termsReady;
    useEffect(() => {
      onReady(ready);
    }, [onReady, ready]);
    return null;
  },
}));
const messages = { "en-US": en, "zh-CN": cn, "zh-HK": hk };
const state = vi.hoisted(() => ({
  cursorError: false,
  termsReady: true,
  interviewReady: true,
  interview: "not_started",
  account: "alice",
  locale: "en-US" as "en-US" | "zh-CN" | "zh-HK",
  translate: false,
  negotiable: true,
  period: "month",
  createdAt: "2026-09-12T00:00:00Z",
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
  useTranslations:
    (namespace: string) =>
    (key: string, args: Record<string, unknown> = {}) => {
      if (!state.translate) return key;
      const namespaces = messages[state.locale] as unknown as Record<
        string,
        Record<string, string>
      >;
      const text = namespaces[namespace]?.[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? `{${name}}`));
    },
  useLocale: () => state.locale,
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
          interview: { state: state.interview },
          status: "pending",
          message: "Application " + id,
          createdAt: state.createdAt,
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
            salary: {
              negotiable: state.negotiable,
              period: state.period,
              currency: "USD",
              minAmount: 10000,
              maxAmount: 20000,
            },
            targetCount: 1,
            recruitedCount: 0,
          },
        ],
    isError: state.failed === "positions",
    error: state.cursorError
      ? new CursorApiError(400, { code: "CREW_POSITION_CURSOR_INVALID" })
      : new Error("Positions unavailable"),
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
  state.termsReady = true;
  state.interviewReady = true;
  state.interview = "not_started";
  state.cursorError = false;
  vi.clearAllMocks();
  state.account = "alice";
  state.locale = "en-US";
  state.translate = false;
  state.negotiable = true;
  state.period = "month";
  state.createdAt = "2026-09-12T00:00:00Z";
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
  vi.restoreAllMocks();
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

it.each(["en-US", "zh-CN", "zh-HK"] as const)(
  "localizes review details, dates and decision errors in %s",
  async (locale) => {
    state.locale = locale;
    state.translate = true;
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-12T02:00:00Z"));
    await render();
    const text = messages[locale].workspace;
    expect(container.textContent).toContain(text.workModeRemote);
    expect(container.textContent).toContain(text.experienceAny);
    expect(container.textContent).toContain(text.salaryNegotiable);
    expect(container.textContent).toContain(messages[locale].crewRoles.director);
    expect(container.textContent).toContain(
      new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-2, "hour")
    );
    state.negotiable = false;
    await render();
    expect(container.textContent).toContain(text.salaryPeriodMonth);
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === text.approve)!.click()
    );
    const handlers = state.approve.mock.calls[0]?.[1];
    await act(async () => {
      handlers.onError({});
      handlers.onSettled();
    });
    expect(state.error).toHaveBeenCalledWith(text.reviewDialogApproveFailed);
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === text.reject)!.click()
    );
    await act(async () => state.reject.mock.calls[0]?.[1].onError({}));
    expect(state.error).toHaveBeenCalledWith(text.reviewDialogRejectFailed);
  }
);
it.each(["episode", "project"])("translates the %s salary period", async (period) => {
  state.translate = true;
  state.locale = "zh-HK";
  state.negotiable = false;
  state.period = period;
  await render();
  expect(container.textContent).toContain(
    period === "episode" ? hk.workspace.salaryPeriodEpisode : hk.workspace.salaryPeriodProject
  );
});
it("formats older application dates in the selected locale", async () => {
  state.translate = true;
  state.locale = "zh-HK";
  state.createdAt = "2026-01-01T00:00:00Z";
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-12T02:00:00Z"));
  await render();
  expect(container.textContent).toContain(new Date(state.createdAt).toLocaleDateString("zh-HK"));
});

it("restarts after the server rejects a continuation cursor", async () => {
  state.cursorError = true;
  state.failed = "positions";
  state.nextPageError = true;
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
  );
  expect(state.positionsRetry).toHaveBeenCalledTimes(1);
  expect(state.nextPage).not.toHaveBeenCalled();
});

it.each(["terms", "interview", "interview-read"])(
  "blocks approval for unresolved %s but retains rejection",
  async (reason) => {
    state.termsReady = reason !== "terms";
    state.interviewReady = reason !== "interview-read";
    state.interview = reason === "interview" ? "confirmed" : "not_started";
    await render();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.find((button) => button.textContent === "approve")!.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent === "reject")!.disabled).toBe(false);
    if (reason === "interview") expect(container.textContent).toContain("interviewBlocked");
  }
);

vi.mock("./application-interview-panel", () => ({
  ApplicationInterviewPanel: ({ onReady }: { onReady: (ready: boolean) => void }) => {
    const ready = state.interviewReady;
    useEffect(() => {
      onReady(ready);
    }, [onReady, ready]);
    return <div>Interview controls</div>;
  },
}));

vi.mock("./application-amendments-panel", () => ({ ApplicationAmendmentsPanel: () => null }));
