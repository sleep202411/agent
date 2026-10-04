// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewApiError } from "../_hooks/api";
import CrewTaskCenter from "./page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  key: [] as unknown[],
  next: vi.fn(),
  get: vi.fn(),
  empty: false,
  nextError: false,
  denialStatus: null as number | null,
  retry: vi.fn(),
  userId: "viewer" as string | null,
  login: vi.fn(),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.login }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.userId ? { id: state.userId } : null, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-tasks", () => ({ useCrewTask: vi.fn(), useCrewTaskTimeline: vi.fn() }));
vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../[id]/workspace/_components/tasks/task-dialogs", () => ({
  SubmitTaskDialog: () => null,
}));
vi.mock("../[id]/workspace/_components/tasks/task-review-form", () => ({
  TaskReviewForm: () => null,
}));
vi.mock("../_components/task-unread-marker", () => ({ TaskUnreadMarker: () => null }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<object>()),
  crewApi: { get: state.get },
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
    "aria-label": label,
  }: {
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
    "aria-label"?: string;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Isolate the shared select boundary in this page test.
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    state.key = queryKey;
    return {
      data: {
        pages: [
          {
            crews: [{ id: "crew-a", name: "Private Crew" }],
            categories: ["edit"],
            items: state.empty
              ? []
              : [
                  {
                    id: "task-1",
                    title: "First review",
                    number: 1,
                    crew: { id: "crew-a", name: "Crew A" },
                    status: "open",
                    workflowState: { name: "To do", systemKey: "open", semantic: "open" },
                    priority: "normal",
                    dueAt: null,
                  },
                  {
                    id: "task-2",
                    title: "Second review",
                    number: 2,
                    crew: { id: "crew-b", name: "Crew B" },
                    status: "in_progress",
                    workflowState: {
                      name: "Colour grading",
                      systemKey: null,
                      semantic: "in_progress",
                    },
                    priority: "high",
                    dueAt: null,
                  },
                ],
          },
        ],
      },
      isError: state.nextError,
      isFetchNextPageError: state.nextError,
      error: state.denialStatus
        ? new CrewApiError(state.denialStatus, { message: "Access denied" })
        : state.nextError
          ? new Error("Page unavailable")
          : null,
      refetch: state.retry,
      hasNextPage: !state.empty,
      fetchNextPage: state.next,
    };
  },
}));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  state.empty = false;
  state.nextError = false;
  state.denialStatus = null;
  state.userId = "viewer";
  vi.clearAllMocks();
});
function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<CrewTaskCenter />));
}
it("shows Crew context and localized task links across Crews, and requests the next page", () => {
  render();
  expect(document.body.textContent).toContain("Crew A");
  expect(document.body.textContent).toContain("Crew B");
  const taskLink = [...document.querySelectorAll("a")].find((link) =>
    link.textContent?.includes("Second review")
  )!;
  expect(taskLink.getAttribute("href")).toBe("/zh-CN/crews/crew-b/workspace?tab=tasks&task=task-2");
  act(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "loadMore")!
      .click()
  );
  expect(state.next).toHaveBeenCalledOnce();
});
it("uses account-scoped queries for creator, producer and status filters", () => {
  render();
  expect(state.key).toEqual(["crew", "task-center", "viewer", "mine", "active", "", "", ""]);
  act(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "producer")!
      .click()
  );
  expect(state.key).toEqual(["crew", "task-center", "viewer", "managed", "active", "", "", ""]);
  act(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "filter_submitted")!
      .click()
  );
  expect(state.key).toEqual(["crew", "task-center", "viewer", "managed", "submitted", "", "", ""]);
});
it("shows an empty state with no load-more action", () => {
  state.empty = true;
  render();
  expect(document.body.textContent).toContain("empty");
  expect(
    [...document.querySelectorAll("button")].find((button) => button.textContent === "loadMore")
  ).toBeUndefined();
});

it("keeps existing tasks visible after a failed next page and retries that page", () => {
  state.nextError = true;
  render();
  expect(document.body.textContent).toContain("First review");
  expect(document.body.textContent).toContain("Second review");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Page unavailable");
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "retry"
  )!;
  act(() => retry.click());
  expect(state.next).toHaveBeenCalledOnce();
});

it("offers sign-in instead of an endless task spinner for a logged-out visitor", () => {
  state.userId = null;
  render();
  expect(document.body.textContent).toContain("signInRequired");
  expect(document.body.textContent).not.toContain("First review");
  const login = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "signIn"
  )!;
  act(() => login.click());
  expect(state.login).toHaveBeenCalledOnce();
});

it("preserves custom workflow names and translates built-in states", () => {
  render();
  expect(document.body.textContent).toContain("Colour grading");
  expect(document.body.textContent).toContain("status.open");
  expect(document.body.textContent).not.toContain("status.in_progress");
});

it.each(["viewer", null])(
  "keeps all Crew destinations available on Tasks for user %s",
  (userId) => {
    state.userId = userId;
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<CrewTaskCenter />));
    const nav = container.querySelector('nav[aria-label="navigationLabel"]')!;
    expect(nav).not.toBeNull();
    expect([...nav.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/zh-CN/crews?view=positions",
      "/zh-CN/messages?tab=recruitment",
      "/zh-CN/crews?view=mine",
      "/zh-CN/crews/tasks",
      "/zh-CN/crews?view=crews",
    ]);
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("taskDashboardTab");
    const dashboard = container.querySelector('nav[aria-label="taskDashboardTab"]')!;
    expect([...dashboard.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/zh-CN/messages?tab=recruitment",
      "/zh-CN/crews/tasks",
    ]);
  }
);

it.each([401, 403, 404])(
  "hides cached tasks and filter metadata after a denied next page (%s)",
  (status) => {
    state.nextError = true;
    state.denialStatus = status;
    render();
    expect(document.body.textContent).not.toContain("First review");
    expect(document.body.textContent).not.toContain("Private Crew");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Access denied");
    act(() =>
      [...document.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
    );
    expect(state.retry).toHaveBeenCalledOnce();
    expect(state.next).not.toHaveBeenCalled();
  }
);
