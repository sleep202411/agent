// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewApiError } from "../_hooks/api";
import { TaskTrackingCard, type TrackingTask } from "./task-tracking-card";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  status: "in_progress",
  error: false,
  next: vi.fn(),
  retry: vi.fn(),
  timelineEnabled: true,
  historyStatus: null as number | null,
  historyRetry: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_components/task-feedback-panel", () => ({
  TaskFeedbackPanel: () => <p>Private feedback</p>,
}));
vi.mock("../_components/task-unread-marker", () => ({ TaskUnreadMarker: () => null }));
vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: () => "Pax",
}));
vi.mock("../_hooks/use-tasks", () => ({
  useCrewTask: () => {
    state.detail();
    return {
      isError: state.error,
      refetch: state.retry,
      error: new Error("Access revoked"),
      data: {
        id: "task",
        crewId: "crew",
        status: state.status,
        description: "Brief",
        submissions: [],
      },
    };
  },
  useCrewTaskTimeline: (_id: string, enabled: boolean) => {
    state.timelineEnabled = enabled;
    return {
      isError: state.historyStatus !== null,
      isFetchNextPageError: state.historyStatus !== null,
      error: state.historyStatus
        ? new CrewApiError(state.historyStatus, { message: "History unavailable" })
        : null,
      refetch: state.historyRetry,
      data: {
        pages: [
          {
            items: [
              {
                id: "event",
                actorUserId: "pax",
                kind: "task.revision_requested",
                payload: { note: "Revise lighting" },
                createdAt: "2026-10-01T02:00:00Z",
              },
            ],
          },
        ],
      },
      hasNextPage: true,
      fetchNextPage: state.next,
    };
  },
}));
vi.mock("../[id]/workspace/_components/tasks/task-dialogs", () => ({
  SubmitTaskDialog: ({ inline, onSubmitted }: { inline: boolean; onSubmitted: () => void }) => (
    <button data-inline={inline} onClick={onSubmitted}>
      Delivery form
    </button>
  ),
}));
vi.mock("../[id]/workspace/_components/tasks/task-review-form", () => ({
  TaskReviewForm: () => <div>Review form</div>,
}));
vi.mock("../[id]/workspace/_components/tasks/task-delivery-summary", () => ({
  TaskDeliverySummary: () => <div>Recorded delivery</div>,
}));
const task: TrackingTask = {
  id: "task",
  title: "Opening scene",
  number: 12,
  status: "in_progress",
  workflowState: { name: "In progress", systemKey: "in_progress", semantic: "in_progress" },
  priority: "normal",
  dueAt: null,
  taskKind: "edit",
  crew: { id: "crew", name: "Film" },
  canSubmit: true,
  canReview: false,
};
let root: Root;
function render(value = task) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<TaskTrackingCard task={value} warningHours={48} />));
}
function click(label: string) {
  act(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent === label)!.click()
  );
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  state.status = "in_progress";
  state.error = false;
  state.timelineEnabled = true;
  state.historyStatus = null;
  vi.clearAllMocks();
});
it("opens inline delivery directly from Submit and closes it after submission", () => {
  render();
  expect(state.detail).not.toHaveBeenCalled();
  click("submit");
  expect(document.querySelector('[data-inline="true"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Pax");
  expect(document.body.textContent).toContain("Revise lighting");
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-01T02:00:00Z");
  click("Delivery form");
  expect(document.querySelector('[data-inline="true"]')).toBeNull();
});
it("expands real history and loads older events without opening submission", () => {
  render();
  click("history");
  expect(document.body.textContent).toContain("activity.revisionRequested");
  expect(document.querySelector('[data-inline="true"]')).toBeNull();
  click("loadMoreHistory");
  expect(state.next).toHaveBeenCalledOnce();
});
it("offers producer review only when supplied by the server", () => {
  state.status = "submitted";
  render({ ...task, status: "submitted", canSubmit: false, canReview: true });
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "submit")
  ).toBe(false);
  click("review");
  expect(document.body.textContent).toContain("Review form");
  expect(document.body.textContent).toContain("Recorded delivery");
});
it("does not show actions without permissions", () => {
  render({ ...task, canSubmit: false });
  expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "history",
  ]);
});
it("opens feedback after approval without exposing delivery or approval actions", () => {
  state.status = "approved";
  render({ ...task, status: "approved", canSubmit: false, canReview: false });
  click("feedback");
  expect(document.body.textContent).toContain("Private feedback");
  expect(document.body.textContent).not.toContain("Review form");
  expect(document.querySelector('[data-inline="true"]')).toBeNull();
});
it("does not open delivery if the fresh task state no longer accepts it", () => {
  state.status = "approved";
  render();
  click("submit");
  expect(document.querySelector('[data-inline="true"]')).toBeNull();
});
it("hides cached delivery and history on a failed access recheck and permits retry", () => {
  state.error = true;
  render();
  click("submit");
  expect(document.querySelector('[data-inline="true"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Access revoked");
  expect(document.body.textContent).not.toContain("Revise lighting");
  expect(document.body.textContent).not.toContain("Pax");
  expect(document.querySelector("time")).toBeNull();
  expect(state.timelineEnabled).toBe(false);
  click("retry");
  expect(state.retry).toHaveBeenCalledOnce();
  expect(state.next).not.toHaveBeenCalled();
});

it.each([401, 403, 404])("hides cached task history after a denied history page (%s)", (status) => {
  state.historyStatus = status;
  render();
  click("history");
  expect(document.body.textContent).not.toContain("Revise lighting");
  expect(document.body.textContent).not.toContain("Recorded delivery");
  expect(document.body.textContent).toContain("History unavailable");
  click("retry");
  expect(state.historyRetry).toHaveBeenCalledOnce();
  expect(state.next).not.toHaveBeenCalled();
});
it("preserves history on a transient next-page failure", () => {
  state.historyStatus = 503;
  render();
  click("history");
  expect(document.body.textContent).toContain("Revise lighting");
  click("retry");
  expect(state.next).toHaveBeenCalledOnce();
});
