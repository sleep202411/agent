import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskDetail } from "./task-detail";
vi.mock("@/config", () => ({ appEnv: { siteRegion: "global" } }));
vi.mock("./task-delivery-management", () => ({
  TaskDeliveryManagement: () => <div>delivery management</div>,
}));
vi.mock("./task-delete", () => ({
  TaskDelete: ({ onDeleted }: { onDeleted: () => void }) => (
    <button onClick={onDeleted}>deleted task</button>
  ),
}));
vi.mock("./task-closure", () => ({
  TaskClosure: ({ onRefresh }: { onRefresh: () => void }) => (
    <button onClick={onRefresh}>refresh after closure</button>
  ),
}));
vi.mock("./task-custom-fields", () => ({ TaskCustomFields: () => <div>custom fields</div> }));
vi.mock("./task-workflow-editor", () => ({ TaskWorkflowEditor: () => <div>workflow editor</div> }));
vi.mock("./task-planning-editor", () => ({ TaskPlanningEditor: () => <div>planning editor</div> }));
vi.mock("./task-child-create", () => ({
  TaskChildButton: ({ onOpen }: { onOpen: () => void }) => (
    <button onClick={onOpen}>add subtask</button>
  ),
  TaskChildCreate: ({
    onCreated,
    onClose,
  }: {
    onCreated: (id: string) => void;
    onClose: () => void;
  }) => (
    <div>
      <button onClick={() => onCreated("child")}>created child</button>
      <button onClick={onClose}>cancel child</button>
    </div>
  ),
}));
vi.mock("./task-assignments", () => ({ TaskAssignments: () => null }));
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  active: true,
  generation: 1,
  close: vi.fn(),
  web: vi.fn(),
}));
vi.mock("./task-schedule", () => ({ TaskSchedule: () => <div>schedule editor</div> }));
vi.mock("./task-relationship-editor", () => ({
  TaskRelationshipEditor: () => <div>relationship editor</div>,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-brief", () => ({ TaskBrief: () => <div>brief editor</div> }));
vi.mock("./task-submit", () => ({ TaskSubmit: () => <div>submit</div> }));
vi.mock("./task-case-create", () => ({ TaskCaseCreate: () => <div>task case</div> }));
vi.mock("./task-feedback-create", () => ({ TaskFeedbackCreate: () => <div>task feedback</div> }));
vi.mock("./task-review", () => ({ TaskReview: () => <div>review</div> }));
vi.mock("./task-delivery", () => ({ TaskDelivery: () => <div>delivery</div> }));
vi.mock("./task-commitments", () => ({ TaskCommitments: () => <div>commitments</div> }));
vi.mock("./task-timeline", () => ({ TaskTimeline: () => <div>timeline</div> }));
vi.mock("./task-detail-api", async (original) => ({
  ...(await original<typeof import("./task-detail-api")>()),
  fetchTaskDetail: h.fetch,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["1", { nickname: "Artist" }]]),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const detail = {
  taskKind: "music",
  estimatePoints: 8,
  revisionLimit: 3,
  revisionRoundsUsed: 2,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  number: 7,
  priority: "normal",
  title: "Scene",
  description: "Private brief",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: null,
  labels: [{ id: "label", name: "Animation" }],
  assignees: [{ userId: "1" }],
};
const render = (taskId = "task") =>
  act(async () =>
    root.render(
      <TaskDetail
        crewId="crew"
        taskId={taskId}
        generation={1}
        userId="1"
        onClose={h.close}
        onOpenWeb={h.web}
      />
    )
  );
const click = (s: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === s)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.fetch.mockResolvedValue(detail);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows details, resolved assignees, labels and an explicit workspace continuation", async () => {
  await render();
  for (const text of [
    "Scene",
    "Private brief",
    "Review",
    "Artist",
    "Animation",
    "thread.taskUnset",
    "taskSchedule.normal",
  ])
    expect(host.textContent).toContain(text);
  await act(async () => click("thread.taskOpenWorkspace"));
  expect(h.web).toHaveBeenCalledTimes(1);
  await act(async () => click("thread.backToChat"));
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("clears details during refresh and keeps revoked access retryable", async () => {
  await render();
  h.fetch.mockRejectedValueOnce(new Error("Conversation not found"));
  await act(async () => click("thread.refresh"));
  expect(host.textContent).not.toContain("Private brief");
  expect(host.textContent).toContain("Conversation not found");
  expect(host.textContent).not.toContain("thread.taskOpenWorkspace");
  await act(async () => click("inbox.retry"));
  expect(host.textContent).toContain("Private brief");
});
it("aborts replaced/backgrounded requests and suppresses late private results", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.fetch.mock.calls[0][2];
  await render("other");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...detail, title: "Old secret" }));
  expect(host.textContent).not.toContain("Old secret");
  h.active = false;
  await render("other");
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await render("other");
  expect(host.textContent).toBe("");
});

it("navigates related tasks, returns to the previous task and hands off the current task to Web", async () => {
  const related = {
    id: "related",
    number: 8,
    title: "Blocking render",
    status: "in_progress",
    workflowState: { name: "In progress" },
    parentId: null,
    resolved: false,
  };
  h.fetch.mockImplementation((_crew: string, id: string) =>
    Promise.resolve(
      id === "task" ? { ...detail, blockedBy: [related] } : { ...detail, title: "Related detail" }
    )
  );
  await render();
  expect(host.textContent).toContain("taskRelations.unresolved");
  await act(async () => click("TASK-8 · Blocking renderIn progress · taskRelations.unresolved"));
  expect(h.fetch).toHaveBeenLastCalledWith("crew", "related", expect.any(AbortSignal));
  expect(host.textContent).toContain("Related detail");
  await act(async () => click("thread.taskOpenWorkspace"));
  expect(h.web).toHaveBeenLastCalledWith("related");
  await act(async () => {
    click("taskRelations.backToTask");
    click("taskRelations.backToTask");
  });
  expect(h.fetch).toHaveBeenLastCalledWith("crew", "task", expect.any(AbortSignal));
  expect(h.close).not.toHaveBeenCalled();
  await act(async () => click("thread.backToChat"));
  expect(h.close).toHaveBeenCalledOnce();
});
it("shows denied related-task access without retaining the previous task data", async () => {
  const related = {
    id: "related",
    number: 8,
    title: "Parent",
    status: "open",
    workflowState: { name: "Open" },
    parentId: null,
  };
  h.fetch
    .mockResolvedValueOnce({ ...detail, parent: related })
    .mockRejectedValueOnce(new Error("Task not found"));
  await render();
  await act(async () => click("TASK-8 · ParentOpen"));
  expect(host.textContent).toContain("Task not found");
  expect(host.textContent).not.toContain("Private brief");
  expect(host.textContent).not.toContain("thread.taskOpenWorkspace");
  expect(host.textContent).toContain("taskRelations.backToTask");
});

it("displays the returned task kind to task viewers", async () => {
  await render();
  expect(host.textContent).toContain("taskKind.label");
  expect(host.textContent).toContain("taskKind.music");
});

it("shows estimate and revision usage to task viewers", async () => {
  await render();
  expect(host.textContent).toContain("taskPlanning.estimate: 8");
  expect(host.textContent).toContain("taskPlanning.revisionsUsed: 2 / 3");
});

it("opens a created child and preserves back navigation to its parent", async () => {
  await render();
  await act(async () => click("add subtask"));
  await act(async () => click("created child"));
  expect(h.fetch).toHaveBeenLastCalledWith("crew", "child", expect.any(AbortSignal));
  await act(async () => click("taskRelations.backToTask"));
  expect(h.fetch).toHaveBeenLastCalledWith("crew", "task", expect.any(AbortSignal));
  expect(h.close).not.toHaveBeenCalled();
});
it("returns to and refreshes the parent after cancelling child creation", async () => {
  await render();
  const count = h.fetch.mock.calls.length;
  await act(async () => click("add subtask"));
  await act(async () => click("cancel child"));
  expect(h.fetch.mock.calls.length).toBe(count + 1);
  expect(h.close).not.toHaveBeenCalled();
});

it("reloads the task after closure", async () => {
  await render();
  await act(async () => click("refresh after closure"));
  expect(h.fetch).toHaveBeenCalledTimes(2);
});

it("leaves the deleted task detail", async () => {
  await render();
  await act(async () => click("deleted task"));
  expect(h.close).toHaveBeenCalledOnce();
});
