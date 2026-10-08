import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskDetail } from "./task-detail";
import { api } from "@/lib/api-client";
import { TaskCenter } from "./task-center";
import type { TaskSubmitSession } from "./use-task-submit-session";
vi.mock("./crew-compute", () => ({
  CrewCompute: ({ initialTaskId }: { initialTaskId: string }) => (
    <div>compute for {initialTaskId}</div>
  ),
}));
vi.mock("./task-edit", () => ({
  TaskEdit: ({ onClose }: { onClose(): void }) => (
    <div>
      populated task form<button onClick={onClose}>close form</button>
    </div>
  ),
}));
vi.mock("./position-create", () => ({ PositionCreate: () => null }));
vi.mock("./task-management-menu", () => ({
  TaskManagementMenu: ({ edit, credit }: { edit(): void; credit(): void }) => (
    <>
      <button onClick={edit}>taskMenu.edit</button>
      <button onClick={credit}>taskMenu.addCredit</button>
    </>
  ),
}));
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
vi.mock("./task-invite-links", () => ({ TaskInviteLinks: () => null }));
vi.mock("./task-contract-files", () => ({
  TaskContractFiles: ({ taskId }: { taskId: string }) => <span>contracts:{taskId}</span>,
}));
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  focused: true,
  active: true,
  generation: 1,
  close: vi.fn(),
  web: vi.fn(),
  timelineUnmount: vi.fn(),
}));
vi.mock("./task-schedule", () => ({ TaskSchedule: () => <div>schedule editor</div> }));
vi.mock("./task-relationship-editor", () => ({
  TaskRelationshipEditor: () => <div>relationship editor</div>,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-brief", () => ({ TaskBrief: () => <div>brief editor</div> }));
vi.mock("./task-submit", () => ({
  TaskSubmissionUpload: () => null,
  TaskSubmit: ({ session }: { session: TaskSubmitSession }) => (
    <input
      aria-label="submission note"
      value={session.note}
      onChange={(event) => session.setNote(event.target.value)}
    />
  ),
}));
vi.mock("./use-task-center", () => ({
  useTaskCenter: () => ({
    items: [
      {
        id: "task",
        title: "Center task",
        number: 7,
        crew: { id: "crew", name: "Crew" },
        workflowState: { name: "Open" },
        priority: "normal",
        dueAt: null,
      },
    ],
    loading: false,
    hasMore: false,
  }),
}));
vi.mock("./use-task-unread", () => ({ useTaskUnread: () => ({ counts: {} }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/authed-web-view", () => ({ AuthedWebView: () => null }));
vi.mock("./task-case-create", () => ({ TaskCaseCreate: () => <div>task case</div> }));
vi.mock("./task-feedback-create", () => ({ TaskFeedbackCreate: () => <div>task feedback</div> }));

vi.mock("./task-delivery", () => ({ TaskDelivery: () => <div>delivery</div> }));
vi.mock("./task-commitments", () => ({ TaskCommitments: () => <div>commitments</div> }));
vi.mock("./task-timeline", () => ({
  TaskTimeline: function MockTimeline({ suspended }: { suspended: boolean }) {
    const [draft, setDraft] = useState("");
    useEffect(() => () => h.timelineUnmount(), []);
    return suspended ? null : (
      <input aria-label="comment" value={draft} onChange={(e) => setDraft(e.target.value)} />
    );
  },
}));
vi.mock("./task-detail-api", async (original) => ({
  ...(await original<typeof import("./task-detail-api")>()),
  fetchTaskDetail: h.fetch,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
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
  TextInput: ({
    value,
    editable,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    editable?: boolean;
    onChangeText: (value: string) => void;
    accessibilityLabel?: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  FlatList: ({
    data,
    renderItem,
  }: {
    data: unknown[];
    renderItem: (props: { item: unknown }) => ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={index}>{renderItem({ item })}</div>
      ))}
    </div>
  ),
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
  id: "task",
  submissions: [],
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
const render = async (taskId = "task", action: "edit" | undefined = "edit") => {
  await act(async () =>
    root.render(
      <TaskDetail
        initialAction={action}
        crewId="crew"
        taskId={taskId}
        generation={1}
        userId="1"
        onClose={h.close}
        onOpenWeb={h.web}
      />
    )
  );
  // Detail controls remain available after closing the dedicated full-form editor.
  const close = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "close form"
  );
  if (close) await act(async () => close.click());
};
const click = (s: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === s)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.focused = true;
  h.active = true;
  h.generation = 1;
  h.fetch.mockResolvedValue(detail);
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.review"] });
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
  h.focused = false;
  await render("other");
  expect(host.textContent).toBe("");
  h.focused = true;
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

it("retains comment composition across detail failure/retry and cancelled child creation", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="comment"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Unsent note"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  h.fetch.mockRejectedValueOnce(new Error("Refresh failed"));
  await act(async () => click("thread.refresh"));
  expect(host.querySelector<HTMLInputElement>('input[aria-label="comment"]')).toBeNull();
  expect(h.timelineUnmount).not.toHaveBeenCalled();
  await act(async () => click("inbox.retry"));
  expect(host.querySelector<HTMLInputElement>('input[aria-label="comment"]')!.value).toBe(
    "Unsent note"
  );
  await act(async () => click("add subtask"));
  expect(host.querySelector<HTMLInputElement>('input[aria-label="comment"]')).toBeNull();
  await act(async () => click("cancel child"));
  expect(host.querySelector<HTMLInputElement>('input[aria-label="comment"]')!.value).toBe(
    "Unsent note"
  );
  expect(h.timelineUnmount).not.toHaveBeenCalled();
  h.focused = false;
  await render();
  expect(h.timelineUnmount).toHaveBeenCalledTimes(1);
});

const renderCenter = () => act(async () => root.render(<TaskCenter userId="1" generation={1} />));
const noteInput = () => host.querySelector<HTMLInputElement>('input[aria-label="submission note"]');
async function composeSubmission() {
  await act(async () => {
    const input = noteInput()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Keep my delivery draft"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("preserves a Task Center draft across background and refreshes details before return", async () => {
  await renderCenter();
  await act(async () =>
    click("Crew · #7Center taskOpen · taskSchedule.normalcrewTaskCenter.history")
  );
  await composeSubmission();
  h.active = false;
  await renderCenter();
  expect(h.timelineUnmount).not.toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  h.active = true;
  await renderCenter();
  expect(host.textContent).not.toContain("Private brief");
  expect(noteInput()).toBeNull();
  await act(async () => resolve({ ...detail, title: "Updated task" }));
  expect(host.textContent).toContain("Updated task");
  expect(noteInput()!.value).toBe("Keep my delivery draft");
  expect(h.fetch).toHaveBeenCalledTimes(2);
});
it("keeps a returning Task Center draft through access failure and retry", async () => {
  await renderCenter();
  await act(async () =>
    click("Crew · #7Center taskOpen · taskSchedule.normalcrewTaskCenter.history")
  );
  await composeSubmission();
  h.active = false;
  await renderCenter();
  h.fetch.mockRejectedValueOnce(new Error("Task access denied"));
  h.active = true;
  await renderCenter();
  expect(host.textContent).toContain("Task access denied");
  expect(host.textContent).not.toContain("Private brief");
  expect(noteInput()).toBeNull();
  await act(async () => click("inbox.retry"));
  expect(noteInput()!.value).toBe("Keep my delivery draft");
  h.generation = 2;
  await renderCenter();
  expect(host.textContent).toBe("");
});

it("refreshes direct task entries on foreground without replacing their draft session", async () => {
  await render();
  await composeSubmission();
  h.active = false;
  await render();
  h.fetch.mockRejectedValueOnce(new Error("Access revoked while away"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Access revoked while away");
  expect(host.textContent).not.toContain("Private brief");
  expect(noteInput()).toBeNull();
  await act(async () => click("inbox.retry"));
  expect(noteInput()!.value).toBe("Keep my delivery draft");
  expect(h.fetch).toHaveBeenCalledTimes(3);
});

it("rejects a late pre-return read after a new foreground read starts", async () => {
  let finish!: (value: unknown) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const oldSignal = h.fetch.mock.calls[0][2];
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(oldSignal.aborted).toBe(true);
  expect(h.fetch).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ...detail, title: "Retired response" }));
  expect(host.textContent).not.toContain("Retired response");
  expect(host.textContent).toContain("Scene");
});

it("keeps child creation context mounted while its parent revalidates on return", async () => {
  await render();
  await act(async () => click("add subtask"));
  h.active = false;
  await render();
  let finish!: (value: unknown) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  h.active = true;
  await render();
  expect(host.textContent).toContain("cancel child");
  await act(async () => finish({ ...detail, title: "Updated parent" }));
  expect(host.textContent).toContain("cancel child");
  await act(async () => click("cancel child"));
  expect(host.textContent).toContain("Private brief");
});

const submittedDetail = {
  ...detail,
  id: "task",
  crewId: "crew",
  status: "submitted",
  submissions: [{ id: "submission-1", assets: [] }],
};
const reviewNote = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="taskReview.reviewNotePlaceholder"]');
async function composeReview() {
  await act(async () => {
    const input = reviewNote()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Please correct the final frame"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("retains the real review panel's note through a failed foreground read and retry", async () => {
  h.fetch.mockResolvedValue(submittedDetail);
  await render();
  await composeReview();
  h.active = false;
  await render();
  h.fetch.mockRejectedValueOnce(new Error("Task temporarily unavailable"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Task temporarily unavailable");
  expect(reviewNote()).toBeNull();
  await act(async () => click("inbox.retry"));
  expect(reviewNote()!.value).toBe("Please correct the final frame");
  expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
});
it("rereads review permission on return and discards an older submission's review draft", async () => {
  h.fetch.mockResolvedValue(submittedDetail);
  await render();
  await composeReview();
  h.active = false;
  await render();
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: [] });
  h.active = true;
  await render();
  expect(reviewNote()).toBeNull();
  expect(host.textContent).not.toContain("taskReview.approve");
  h.active = false;
  await render();
  h.fetch.mockResolvedValue({
    ...submittedDetail,
    submissions: [{ id: "submission-2", assets: [] }],
  });
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.review"] });
  h.active = true;
  await render();
  expect(reviewNote()!.value).toBe("");
});

it("discovers retained contract files even when the original link is absent", async () => {
  h.fetch.mockResolvedValueOnce({ ...detail, contractAssetNodeId: "linked-file" });
  await render();
  expect(host.textContent).toContain(`contracts:${detail.id}`);
  await act(async () => click("thread.refresh"));
  expect(host.textContent).toContain(`contracts:${detail.id}`);
});

it("opens the simple task view by default and exposes management through Edit", async () => {
  await act(async () =>
    root.render(
      <TaskDetail
        crewId="crew"
        taskId="task"
        generation={1}
        userId="1"
        onClose={h.close}
        onOpenWeb={h.web}
      />
    )
  );
  expect(host.textContent).toContain("Private brief");
  expect(host.textContent).not.toContain("custom fields");
  expect(host.textContent).not.toContain("workflow editor");
  await act(async () => click("taskMenu.edit"));
  expect(host.textContent).toContain("populated task form");
  await act(async () => click("close form"));
  await act(async () => click("taskMenu.addCredit"));
  expect(host.textContent).toContain("compute for");
});
