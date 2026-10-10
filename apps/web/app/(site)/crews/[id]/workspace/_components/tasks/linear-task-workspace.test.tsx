vi.mock("./task-delivery-template", () => ({
  TaskDeliveryTemplatePanel: () => <div data-template-selector />,
}));
vi.mock("./task-creation-workbench", () => ({
  TaskCreationWorkbench: ({
    active,
    onSubmitTask,
    onEditTask,
  }: {
    active: boolean;
    onSubmitTask: (id: string) => void;
    onEditTask?: (id: string) => void;
  }) =>
    active ? (
      <div data-workbench>
        <button onClick={() => onSubmitTask("delivery")}>Submit from workbench</button>
        <button onClick={() => onEditTask?.("delivery")}>Edit from workbench</button>
      </div>
    ) : null,
}));
vi.mock("./trust-appeal-link", () => ({
  TrustAppealLink: () => <span data-trust-appeals>Trust appeals</span>,
}));
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { LinearTaskWorkspace } from "./linear-task-workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  locale: "en-US",
  owner: false,
  canSubmit: false,
  assignee: "alice",
  taskStatus: "open",
  layout: "board",
  account: "alice",
  projectFailed: false,
  projectMissing: false,
  projectFetching: false,
  listFailed: false,
  failed: false,
  failureStatus: null as number | null,
  missing: false,
  retry: vi.fn(),
  saveWorkflow: vi.fn(),
  workflow: {
    id: "workflow-open",
    name: "To do",
    color: "#888888",
    systemKey: "open" as const,
    semantic: "open" as const,
    version: 3,
    archived: false,
    position: 0,
  },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => {
    const messages = state.locale === "zh-CN" ? cn : state.locale === "zh-HK" ? hk : en;
    return String(
      key
        .split(".")
        .reduce<unknown>(
          (value: unknown, part): unknown =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[part]
              : undefined,
          messages.crewTaskProject
        ) ?? key
    );
  },
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCreateCrewTaskView: mutation,
    useCreateCrewTaskWorkflowState: mutation,
    useDeleteCrewTaskView: mutation,
    useReorderCrewTask: mutation,
    useUpdateCrewTask: mutation,
    useUpdateCrewTaskView: mutation,
    useUpdateCrewTaskWorkflowState: () => ({ mutateAsync: state.saveWorkflow, isPending: false }),
    useCrewProductionOverview: () => ({
      data: {
        project: { startDate: null },
        page: { createdAt: "2026-09-08" },
        capabilities: { manage: false },
      },
    }),
    useCrewProductionActivity: () => ({ data: { pages: [] } }),
    useCrewTask: (id: string) => ({
      data:
        id && !state.missing
          ? {
              id,
              title: "Selected task",
              status: state.taskStatus,
              assignees: [{ userId: state.assignee }],
            }
          : undefined,
      isError: state.failed,
      error: state.failed
        ? state.failureStatus
          ? new CrewApiError(state.failureStatus, { message: "Task access unavailable" })
          : new Error("Task refresh unavailable")
        : null,
      refetch: state.retry,
    }),
    useCrewTaskSummary: () => ({ data: {} }),
    useCrewTaskProject: () => ({
      isError: state.projectFailed,
      error: new Error("Project refresh unavailable"),
      isFetching: state.projectFetching,
      refetch: state.retry,
      data: state.projectMissing
        ? undefined
        : {
            cycles: [],
            fields: [],
            labels: [],
            workflowStates: [],
            views: [
              {
                id: "default",
                name: "issues",
                layout: state.layout,
                filters: {},
                sorts: [],
                visibleFields: [],
                groupBy: "status",
                completedMode: "all",
                showSubIssues: true,
                showEmptyGroups: false,
              },
            ],
          },
    }),
    useCrewTaskView: () => ({
      data: [],
      workflowCounts: {},
      isError: state.listFailed,
      error: new Error("Task list unavailable"),
      refetch: state.retry,
    }),
  };
});
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ useUserDisplays: () => ({}) }));
vi.mock("./task-project-views", () => ({
  TaskProjectView: ({
    view,
    onOpenTask,
    onEditWorkflowState,
  }: {
    view: { layout: string };
    onOpenTask: (id: string) => void;
    onEditWorkflowState: (value: typeof state.workflow) => void;
  }) => (
    <div data-layout={view.layout}>
      <button onClick={() => onOpenTask("task-1")}>Open task</button>
      <button onClick={() => onEditWorkflowState(state.workflow)}>Edit workflow fixture</button>
    </div>
  ),
}));
vi.mock("./production-overview", () => ({ ProductionOverview: () => <div data-overview /> }));
vi.mock("./production-project-update", () => ({
  ProductionActivityComposer: () => null,
  ProductionActivityEntry: () => null,
}));
vi.mock("./task-edit-form", () => ({
  TaskEditForm: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
    <div data-editing="true">
      Full task form<button onClick={() => onOpenChange(false)}>Close task</button>
    </div>
  ),
}));
vi.mock("./task-issue-detail", () => ({
  TaskIssueDetail: function Detail({
    onClose,
    initiallyEditing,
  }: {
    onClose: () => void;
    initiallyEditing?: boolean;
  }) {
    const [editing] = useState(Boolean(initiallyEditing));
    const [draft, setDraft] = useState("");
    return (
      <>
        <span data-editing={editing}>Task detail</span>
        <button onClick={onClose}>Close task</button>
        <button onClick={() => setDraft("Private task draft")}>{draft || "Edit draft"}</button>
      </>
    );
  },
}));
vi.mock("./task-project-settings", () => ({ ProjectSettingsDialog: () => null }));
vi.mock("./task-quick-create", () => ({
  TaskQuickCreate: ({
    open,
    crewId,
    presetWorkflowStateId,
    onOpenChange,
  }: {
    open: boolean;
    crewId: string;
    presetWorkflowStateId: string | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-create-task={crewId} data-preset={String(presetWorkflowStateId)}>
        Task creation dialog
        <button onClick={() => onOpenChange(false)}>Cancel creation</button>
      </div>
    ) : null,
}));
vi.mock("./task-dialogs", () => ({
  SubmitTaskDialog: ({ readOnly }: { readOnly?: boolean }) =>
    readOnly ? (
      <div data-delivery-preview>Delivery preview</div>
    ) : (
      <div data-delivery-form>Shared delivery form</div>
    ),
}));
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  state.owner = false;
  state.canSubmit = false;
  state.assignee = "alice";
  state.taskStatus = "open";
  state.projectFailed = false;
  state.projectMissing = false;
  state.projectFetching = false;
  state.listFailed = false;
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  state.account = "alice";
  state.failed = false;
  state.failureStatus = null;
  state.missing = false;
  state.retry.mockClear();
  state.saveWorkflow.mockReset();
  state.workflow.name = "To do";
  state.workflow.version = 3;
});
async function render(
  deeplinkTaskId?: string | null,
  reuse = false,
  production = false,
  createTaskRequested = false,
  handled?: () => void
) {
  if (!reuse) {
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
  }
  await act(async () =>
    root.render(
      <LinearTaskWorkspace
        createTaskRequested={createTaskRequested}
        onCreateTaskRequestHandled={handled}
        deeplinkTaskId={deeplinkTaskId}
        crewId="crew"
        crewName="Test12"
        crewSummary=""
        crewLogo=""
        crewVersion={1}
        canEditCrewInfo={false}
        members={[]}
        isOwner={state.owner}
        canCreate={state.owner}
        canReview={false}
        canSubmitAssigned={state.canSubmit}
        viewerUserId={state.account}
        canComment={false}
      />
    )
  );
  if (!production)
    await act(async () => (document.querySelectorAll("nav button")[1] as HTMLElement)?.click());
}
describe("Crew task navigation", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])(
    "opens Tasks and preserves tab destinations in %s",
    async (locale) => {
      state.locale = locale;
      state.layout = "board";
      await render(undefined, false, true);
      const m = (locale === "zh-CN" ? cn : locale === "zh-HK" ? hk : en).crewTaskProject;
      const tabs = [...document.querySelectorAll("nav button")];
      expect(tabs.slice(0, 4).map((el) => el.textContent)).toEqual([
        m.workbench.title,
        m.issues,
        m.overview,
        m.activity,
      ]);
      expect(document.querySelector("[data-workbench]")).not.toBeNull();
      expect(document.querySelector("[data-trust-appeals]")).toBeNull();
      expect(document.querySelector("[data-layout]")).toBeNull();
      await act(async () => (tabs[2] as HTMLElement).click());
      expect(document.querySelector("[data-overview]")).not.toBeNull();
      await act(async () => (tabs[3] as HTMLElement).click());
      expect(document.querySelector("[data-overview]")).toBeNull();
      expect(document.querySelector("[data-layout]")).toBeNull();
      await act(async () => (tabs[1] as HTMLElement).click());
      expect(document.querySelector('[data-layout="board"]')).not.toBeNull();
    }
  );
  it("honors an existing saved List preference", async () => {
    state.layout = "list";
    await render();
    expect(document.querySelector('[data-layout="list"]')).not.toBeNull();
  });
});

it.each(["list", "board"])(
  "preserves the %s view, filter and scroll after closing task details",
  async (layout) => {
    state.layout = layout;
    state.locale = "en-US";
    await render();
    const list = document.querySelector("main")!;
    list.scrollTop = 160;
    const search = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "search term"
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (document.querySelector("[data-layout] button") as HTMLElement).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("main")).toBe(list);
    expect(document.querySelector(`[data-layout="${layout}"]`)).not.toBeNull();
    const close = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Close task"
    )!;
    await act(async () => close.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("main")).toBe(list);
    expect(list.scrollTop).toBe(160);
    expect(search.value).toBe("search term");
  }
);

it("keeps a task opened before the initial animation frame", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  await render();
  await act(async () => (document.querySelector("[data-layout] button") as HTMLElement).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    const pending = Array.from(frames.values());
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("follows changed deep links in the same workspace", async () => {
  await render("task-1");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await render(null, true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("task-1", true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("starts fresh drawer state when another account has the same task cached", async () => {
  await render("task-1");
  const edit = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Edit draft"
  )!;
  await act(async () => edit.click());
  expect(document.body.textContent).toContain("Private task draft");
  state.account = "bob";
  await render("task-1", true);
  expect(document.body.textContent).not.toContain("Private task draft");
  expect(document.body.textContent).toContain("Edit draft");
});

it("keeps unsaved task details mounted after a background refresh fails", async () => {
  state.locale = "en-US";
  await render("task-1");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Edit draft")!
      .click()
  );
  state.failed = true;
  await render("task-1", true);
  expect(document.body.textContent).toContain("Private task draft");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Task refresh unavailable");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click()
  );
  expect(state.retry).toHaveBeenCalledOnce();
  state.failed = false;
  await render("task-1", true);
  expect(document.body.textContent).toContain("Private task draft");
});

it("offers a retry when task details fail before any data loads", async () => {
  state.locale = "en-US";
  state.failed = true;
  state.missing = true;
  await render("task-1");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Task refresh unavailable");
  expect(document.body.textContent).not.toContain("Edit draft");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click()
  );
  expect(state.retry).toHaveBeenCalledOnce();
});

it("shows task-list failure and retries without claiming an empty successful load", async () => {
  state.listFailed = true;
  await render();
  expect(document.body.textContent).toContain("Task list unavailable");
  const retry = [...document.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(state.retry).toHaveBeenCalledTimes(1);
});

it("keeps the task editor draft when project configuration refresh fails", async () => {
  state.locale = "en-US";
  await render("task-1");
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
  act(() => button("Edit draft").click());
  const draft = button("Private task draft");
  state.projectFailed = true;
  await render("task-1", true);
  expect(button("Private task draft")).toBe(draft);
  expect(document.body.textContent).toContain("Project refresh unavailable");
  await act(async () => button(en.crewTaskProject.retry).click());
  expect(state.retry).toHaveBeenCalledOnce();
  state.projectFetching = true;
  await render("task-1", true);
  expect(button(en.crewTaskProject.retry).disabled).toBe(true);
  state.projectFetching = false;
  state.projectFailed = false;
  await render("task-1", true);
  expect(button("Private task draft")).toBe(draft);
});

it("offers retry when the initial project configuration load fails", async () => {
  state.locale = "en-US";
  state.projectFailed = true;
  state.projectMissing = true;
  await render();
  const retry = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === en.crewTaskProject.retry
  );
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(state.retry).toHaveBeenCalledOnce();
});

it.each(["board", "list"])(
  "opens task initiation from the primary action in %s layout",
  async (layout) => {
    state.owner = true;
    state.locale = "en-US";
    state.layout = layout;
    await render();
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Create Task"
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(document.querySelector('[data-create-task="crew"]')).not.toBeNull();
    expect(document.querySelector("[data-create-task]")?.getAttribute("data-preset")).toBe("null");
  }
);
it.each([
  ["en-US", "Create Task"],
  ["zh-CN", "发起任务"],
  ["zh-HK", "發起任務"],
])("localizes task initiation in %s", async (locale, label) => {
  state.owner = true;
  state.locale = locale;
  await render();
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === label)
  ).toBe(true);
});
it("does not grant ordinary members task creation", async () => {
  state.owner = false;
  state.locale = "en-US";
  await render();
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Create Task")
  ).toBe(false);
  expect(document.querySelector("[data-create-task]")).toBeNull();
});

it.each([401, 403, 404, 410])(
  "removes cached task details after HTTP %s and allows recovery",
  async (status) => {
    state.locale = "en-US";
    await render("task-1");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Edit draft")!
        .click()
    );
    state.failed = true;
    state.failureStatus = status;
    await render("task-1", true);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).not.toContain("Private task draft");
    expect(dialog.textContent).not.toContain("Selected task");
    expect(dialog.textContent).not.toContain("Edit draft");
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Task access unavailable");
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click()
    );
    expect(state.retry).toHaveBeenCalledOnce();
    state.failed = false;
    await render("task-1", true);
    expect(document.body.textContent).toContain("Edit draft");
    expect(document.body.textContent).not.toContain("Private task draft");
  }
);

it.each(["en-US", "zh-CN", "zh-HK"])(
  "saves and reopens workflow edits in %s, retaining a rejected draft",
  async (locale) => {
    state.locale = locale;
    state.owner = true;
    state.layout = "board";
    const messages = locale === "zh-CN" ? cn : locale === "zh-HK" ? hk : en;
    const t = messages.crewTaskProject;
    await render();
    const click = async (label: string) =>
      act(async () => {
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent === label)!
          .click();
      });
    await click("Edit workflow fixture");
    const nameInput = () =>
      document.querySelector<HTMLInputElement>(`input[placeholder="${t.workflowColumnName}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        nameInput(),
        "剪辑初审"
      );
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    state.saveWorkflow.mockRejectedValueOnce(new Error("Version conflict"));
    await click(t.save);
    expect(nameInput().value).toBe("剪辑初审");
    state.saveWorkflow.mockImplementationOnce(
      async ({ input }: { input: { name: string; expectedVersion: number } }) => {
        state.workflow.name = input.name;
        state.workflow.version++;
      }
    );
    await click(t.save);
    expect(state.saveWorkflow).toHaveBeenLastCalledWith({
      stateId: "workflow-open",
      input: { expectedVersion: 3, name: "剪辑初审", color: "#888888" },
    });
    expect(nameInput()).toBeNull();
    await click("Edit workflow fixture");
    expect(nameInput().value).toBe("剪辑初审");
    expect(state.workflow.systemKey).toBe("open");
  }
);

it("opens a task request, consumes cancellation, and accepts a later request in the same Crew", async () => {
  state.owner = true;
  const handled = vi.fn();
  await render(undefined, false, true, true, handled);
  expect(document.querySelector('[data-create-task="crew"]')).not.toBeNull();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Cancel creation")!
      .click()
  );
  expect(handled).toHaveBeenCalledTimes(1);
  expect(document.querySelector("[data-create-task]")).toBeNull();
  await render(undefined, true, true, false, handled);
  await render(undefined, true, true, true, handled);
  expect(document.querySelector('[data-create-task="crew"]')).not.toBeNull();
});
it("does not open a requested task editor without create permission", async () => {
  state.owner = false;
  await render(undefined, false, true, true);
  expect(document.querySelector("[data-create-task]")).toBeNull();
});

it.each([
  [true, "alice", "open", true],
  [true, "alice", "revision_requested", true],
  [false, "alice", "open", false],
  [true, "bob", "open", false],
  [true, "alice", "approved", false],
])(
  "checks capability %s, assignee %s and status %s before opening submission",
  async (capability, assignee, status, allowed) => {
    state.canSubmit = capability;
    state.assignee = assignee;
    state.taskStatus = status;
    await render(undefined, false, true);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Submit from workbench")!
        .click()
    );
    expect(Boolean(document.querySelector("[data-delivery-form]"))).toBe(allowed);
    if (allowed) expect(document.body.textContent).not.toContain("Edit draft");
  }
);

it.each([true, false])(
  "preserves edit mode through URL synchronization (assigned=%s)",
  async (assigned) => {
    state.owner = true;
    state.canSubmit = true;
    state.assignee = assigned ? state.account : "someone-else";
    await render(undefined, false, true);
    const edit = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Edit from workbench"
    )!;
    await act(async () => edit.click());
    expect(document.querySelector('[data-editing="true"]')).not.toBeNull();
    // The parent router echoes the selected task back after updating ?task=delivery.
    await render("delivery", true, true);
    expect(document.querySelector('[data-editing="true"]')).not.toBeNull();
    // A genuinely different URL destination must still open normally.
    await render("other-task", true, true);
    expect(document.querySelector('[data-editing="true"]')).toBeNull();
  }
);

it("opens editing when the same task detail is already mounted", async () => {
  state.owner = true;
  state.assignee = "someone-else";
  await render("delivery", false, true);
  expect(document.querySelector('[data-editing="false"]')).not.toBeNull();
  const edit = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Edit from workbench"
  )!;
  await act(async () => edit.click());
  expect(document.querySelector('[data-editing="true"]')).not.toBeNull();
});

it("closes the inline submission from its visible header button", async () => {
  state.locale = "en-US";
  state.canSubmit = true;
  state.assignee = "alice";
  state.taskStatus = "open";
  await render(undefined, false, true);
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Submit from workbench")!
      .click()
  );
  expect(document.querySelector("[data-delivery-form]")).not.toBeNull();
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(document.querySelector("[data-delivery-form]")).toBeNull();
});
