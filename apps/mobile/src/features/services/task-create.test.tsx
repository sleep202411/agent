import { TaskCreationRequiredError } from "./task-creation-required";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCreate } from "./task-create";
import { TaskChildCreate } from "./task-child-create";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  childContext: vi.fn(),
  defaults: vi.fn(),
  fields: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  workflows: vi.fn(),
  planning: vi.fn(),
  templates: vi.fn(),
  generation: 1,
  active: true,
  suspended: false,
}));
vi.mock("./task-child-context", () => ({ fetchTaskChildContext: h.childContext }));
vi.mock("./task-creation-defaults", () => ({ fetchTaskCreationDefaults: h.defaults }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-custom-fields-api", async (original) => ({
  ...(await original<typeof import("./task-custom-fields-api")>()),
  fetchTaskFieldDefinitions: h.fields,
}));
vi.mock("./task-kind-api", async (original) => ({
  ...(await original<typeof import("./task-kind-api")>()),
  fetchTaskKindTemplates: h.templates,
}));
vi.mock("./task-planning-api", () => ({ fetchTaskPlanningOptions: h.planning }));
vi.mock("./task-workflow-api", () => ({ fetchManualTaskWorkflows: h.workflows }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-create-api", async (original) => ({
  ...(await original<typeof import("./task-create-api")>()),
  createTask: h.update,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (initialParent?: { id: string; number: number; title: string }) =>
  act(async () =>
    root.render(
      <TaskCreate
        suspended={h.suspended}
        crewId="crew"
        initialParent={initialParent}
        userId="1"
        generation={1}
        onCreated={h.refresh}
        onClose={h.refresh}
      />
    )
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
const type = (n: number, text: string) => {
  const input = host.querySelectorAll("input")[n]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.suspended = false;
  h.defaults.mockResolvedValue({ cycle: null, workflow: null });
  h.fields.mockResolvedValue([]);
  h.templates.mockResolvedValue([
    {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "storyboard",
      name: "Storyboard",
      title: "Template shot",
      description: "Template brief",
    },
  ]);
  h.planning.mockImplementation((_crew: string, kind: string) =>
    Promise.resolve([{ id: "44444444-4444-4444-8444-444444444444", name: `Pick ${kind}` }])
  );
  h.workflows.mockResolvedValue([
    {
      id: "33333333-3333-4333-8333-333333333333",
      crewId: "crew",
      name: "Storyboard",
      semantic: "open",
      archived: false,
    },
  ]);
  h.access.mockResolvedValue({ allowed: false, canManage: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

vi.mock("@/config", () => ({ appEnv: { siteRegion: "cn" } }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({
    onSelect,
  }: {
    onSelect: (m: { userId: string; label: string }) => void;
  }) => <button onClick={() => onSelect({ userId: "1", label: "Self" })}>choose member</button>,
}));
it("requires task management permission", async () => {
  h.access.mockResolvedValue({ allowed: true, canManage: false });
  await render();
  expect(button("taskCreate.submit")).toBeUndefined();
  expect(host.textContent).toContain("taskCreate.managerOnly");
});
it("validates dates and submits one trimmed creation with regional assignments", async () => {
  let finish!: (task: { id: string }) => void;
  h.update.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  await act(async () => {
    type(0, " New shot ");
    type(1, " Brief ");
    type(2, "2026-10-05 10:00");
    type(3, "2026-10-04 10:00");
  });
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  await act(async () => type(3, "2026-10-06 10:00"));
  await act(async () => button("taskCreate.add")!.click());
  await act(async () => button("choose member")!.click());
  await act(async () => {
    button("taskCreate.submit")!.click();
    button("taskCreate.submit")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(
    "crew",
    expect.objectContaining({
      title: "New shot",
      description: "Brief",
      assignees: [{ userId: "1", currency: "CNY" }],
    })
  );
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish({ id: "new" }));
  expect(h.refresh).toHaveBeenCalledExactlyOnceWith("new");
});
it("freezes an uncertain creation without retrying", async () => {
  h.update.mockRejectedValue(new Error("Connection lost"));
  await render();
  await act(async () => type(0, "Task"));
  await act(async () => button("taskCreate.submit")!.click());
  expect(host.textContent).toContain("Connection lost");
  expect(host.textContent).toContain("taskCreate.uncertain");
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe("Task");
});
it("ignores completion after an account change", async () => {
  let finish!: (task: { id: string }) => void;
  h.update.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => type(0, "Task"));
  await act(async () => button("taskCreate.submit")!.click());
  h.generation = 2;
  await act(async () => finish({ id: "new" }));
  expect(h.refresh).not.toHaveBeenCalled();
});

const relatedId = "22222222-2222-4222-8222-222222222222";
vi.mock("./task-picker", () => ({
  TaskPicker: ({
    onSelect,
  }: {
    onSelect: (task: { id: string; number: number; title: string }) => void;
  }) => (
    <button
      onClick={() =>
        onSelect({ id: "22222222-2222-4222-8222-222222222222", number: 2, title: "Related" })
      }
    >
      choose task
    </button>
  ),
}));
it("creates a task with its parent and deduplicated blockers", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Child"));
  await act(async () => button("taskRelationships.chooseParent")!.click());
  await act(async () => button("choose task")!.click());
  for (let n = 0; n < 2; n++) {
    await act(async () => button("taskRelationships.addBlocker")!.click());
    await act(async () => button("choose task")!.click());
  }
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ parentId: relatedId, blockedByTaskIds: [relatedId] })
  );
});
it("clears draft parent and blockers before creation", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Independent"));
  await act(async () => button("taskRelationships.chooseParent")!.click());
  await act(async () => button("choose task")!.click());
  await act(async () => button("taskRelationships.removeParent")!.click());
  await act(async () => button("taskRelationships.addBlocker")!.click());
  await act(async () => button("choose task")!.click());
  await act(async () => button("TASK-2 · Related ×")!.click());
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ parentId: null, blockedByTaskIds: [] })
  );
});

it("selects a workflow column and sends it during creation", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Shot"));
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  await act(async () => button("Storyboard")!.click());
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ workflowStateId: "33333333-3333-4333-8333-333333333333" })
  );
});
it("can clear the selected column to use the server default", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Shot"));
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  await act(async () => button("Storyboard")!.click());
  await act(async () => button("Storyboard")!.click());
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update.mock.calls[0]![1]).not.toHaveProperty("workflowStateId");
});
it("shows workflow loading errors and retries without losing the draft", async () => {
  h.workflows.mockRejectedValueOnce(new Error("Service unavailable"));
  await render();
  await act(async () => type(0, "Draft"));
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  expect(host.textContent).toContain("Service unavailable");
  await act(async () => button("inbox.retry")!.click());
  await act(async () => button("Storyboard")!.click());
  expect(host.querySelector("input")!.value).toBe("Draft");
});
it("discards workflow options arriving after an account change", async () => {
  let finish!: (value: unknown[]) => void;
  h.workflows.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  h.generation = 2;
  await act(async () =>
    finish([{ id: "33333333-3333-4333-8333-333333333333", name: "Private Column" }])
  );
  expect(host.textContent).not.toContain("Private Column");
});

it("creates a task with selected episode and labels without a cycle picker", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  for (const kind of ["episode", "labels"]) {
    await act(async () =>
      button(`taskPlanning.${kind}${kind === "labels" ? " · 0/20" : ""}`)!.click()
    );
    await act(async () => button(`Pick ${kind}`)!.click());
  }
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({
      cycleId: null,
      episodeId: "44444444-4444-4444-8444-444444444444",
      labelIds: ["44444444-4444-4444-8444-444444444444"],
    })
  );
});
it("clears planning choices and prevents duplicate label selection", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  for (const kind of ["episode", "labels"]) {
    await act(async () =>
      button(`taskPlanning.${kind}${kind === "labels" ? " · 0/20" : ""}`)!.click()
    );
    await act(async () => button(`Pick ${kind}`)!.click());
  }
  await act(async () => button("taskPlanning.labels · 1/20")!.click());
  expect(button("Pick labels")!.disabled).toBe(true);
  await act(async () => button("common.cancel")!.click());
  await act(async () => button("Pick labels ×")!.click());
  await act(async () => button("taskPlanning.clearEpisode")!.click());
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ cycleId: null, episodeId: null, labelIds: [] })
  );
});
it("keeps creation usable when episode access fails and retries inside the picker", async () => {
  h.planning.mockRejectedValueOnce(new Error("Production permission required"));
  await render();
  await act(async () => type(0, "Draft"));
  await act(async () => button("taskPlanning.episode")!.click());
  expect(host.textContent).toContain("Production permission required");
  await act(async () => button("inbox.retry")!.click());
  expect(button("Pick episode")).toBeDefined();
  await act(async () => button("common.cancel")!.click());
  expect(button("taskCreate.submit")!.disabled).toBe(false);
  expect(host.querySelector("input")!.value).toBe("Draft");
});
it("ignores late planning options after an account change", async () => {
  let finish!: (items: unknown[]) => void;
  h.planning.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskPlanning.episode")!.click());
  h.generation = 2;
  await act(async () =>
    finish([{ id: "44444444-4444-4444-8444-444444444444", name: "Private Episode" }])
  );
  expect(host.textContent).not.toContain("Private Episode");
});

it("selects a kind and fills only an empty title from its first template", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(1, "My brief"));
  await act(async () => button("taskKind.unset")!.click());
  await act(async () => button("taskKind.storyboard")!.click());
  expect(host.querySelectorAll("input")[0]!.value).toBe("Template shot");
  expect(host.querySelectorAll("input")[1]!.value).toBe("My brief");
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({
      taskKind: "storyboard",
      title: "Template shot",
      description: "My brief",
    })
  );
});
it("preserves entered text when changing or clearing the kind", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "My title"));
  await act(async () => button("taskKind.unset")!.click());
  await act(async () => button("taskKind.storyboard")!.click());
  expect(host.querySelector("input")!.value).toBe("My title");
  await act(async () => button("taskKind.storyboard")!.click());
  await act(async () => button("taskKind.unset")!.click());
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ taskKind: null, title: "My title" })
  );
});
it("keeps kind selection available if template loading fails and supports retry", async () => {
  h.templates.mockRejectedValueOnce(new Error("Template service unavailable"));
  await render();
  await act(async () => button("taskKind.unset")!.click());
  expect(host.textContent).toContain("Template service unavailable");
  expect(button("taskKind.art")!.disabled).toBe(false);
  await act(async () => button("inbox.retry")!.click());
  await act(async () => button("taskKind.storyboard")!.click());
  expect(host.querySelector("input")!.value).toBe("Template shot");
});
it("never applies late template responses to a newer draft", async () => {
  let finish!: (items: unknown[]) => void;
  h.templates.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskKind.unset")!.click());
  await act(async () => button("taskKind.storyboard")!.click());
  await act(async () => type(0, "New draft"));
  await act(async () =>
    finish([
      { id: "55555555-5555-4555-8555-555555555555", kind: "storyboard", title: "Old template" },
    ])
  );
  expect(host.querySelector("input")!.value).toBe("New draft");
});

it("starts contextual creation with its parent already selected", async () => {
  h.update.mockResolvedValue({ id: "child" });
  await render({ id: relatedId, number: 9, title: "Parent task" });
  expect(host.textContent).toContain("TASK-9 · Parent task");
  await act(async () => type(0, "Child task"));
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ parentId: relatedId, title: "Child task" })
  );
});

it("includes explicit zero planning values in creation", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => {
    type(0, "Task");
    type(4, "0");
    type(5, "0");
  });
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ estimatePoints: 0, revisionLimit: 0 })
  );
});
it("blocks invalid limits and sends null when planning inputs are cleared", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  for (const [n, value] of [
    [4, "1000001"],
    [4, "1.5"],
    [5, "101"],
    [5, "-1"],
  ] as const) {
    await act(async () => type(n, value));
    expect(button("taskCreate.submit")!.disabled).toBe(true);
    await act(async () => type(n, ""));
  }
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ estimatePoints: null, revisionLimit: null })
  );
});

it("blocks creation while required custom fields are empty, then sends normalized values", async () => {
  h.fields.mockResolvedValue([
    {
      id: relatedId,
      crewId: "crew",
      name: "Required Brief",
      type: "text",
      required: true,
      options: [],
    },
  ]);
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  await act(async () => type(6, "  New brief  "));
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ customFieldValues: [{ fieldId: relatedId, value: "New brief" }] })
  );
});
it("requires successful definition loading and retries without dropping the title", async () => {
  h.fields.mockRejectedValueOnce(new Error("Fields offline"));
  await render();
  await act(async () => type(0, "Task"));
  expect(host.textContent).toContain("Fields offline");
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  await act(async () => button("inbox.retry")!.click());
  expect(host.querySelector("input")!.value).toBe("Task");
  expect(button("taskCreate.submit")!.disabled).toBe(false);
});
it("ignores field definitions returned after account replacement", async () => {
  let finish!: (v: unknown[]) => void;
  h.fields.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  await act(async () => type(0, "Task"));
  h.generation = 2;
  await act(async () => finish([]));
  expect(button("taskCreate.submit")!.disabled).toBe(true);
});
it("stages the validated form without creating a task and blocks duplicate staging", async () => {
  const stage = vi.fn();
  await act(async () =>
    root.render(
      <TaskCreate
        crewId="crew"
        userId="1"
        generation={1}
        onStage={stage}
        onCreated={h.refresh}
        onClose={h.refresh}
      />
    )
  );
  await act(async () => type(0, "Draft storyboard"));
  await act(async () => {
    button("taskWorkbench.stage")!.click();
    button("taskWorkbench.stage")!.click();
  });
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage.mock.calls[0]?.[0].title).toBe("Draft storyboard");
  expect(h.update).not.toHaveBeenCalled();
});

it("loads view defaults before editing and includes them in the submitted draft", async () => {
  const cycle = { id: "44444444-4444-4444-8444-444444444444", name: "Next cycle" };
  const workflow = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Active shots",
    semantic: "in_progress",
    crewId: "crew",
    archived: false,
  };
  h.defaults.mockResolvedValue({ cycle, workflow });
  await render();
  expect(button("taskPlanning.cycle · Next cycle")).toBeUndefined();
  expect(button("taskPlanning.clearCycle")).toBeUndefined();
  expect(host.textContent).toContain("Active shots");
  await act(async () => type(0, "Shot"));
  h.update.mockResolvedValue({ id: "created" });
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update.mock.calls[0]?.[1]).toMatchObject({
    cycleId: cycle.id,
    workflowStateId: workflow.id,
    priority: "normal",
    labelIds: [],
    assignees: [],
  });
});
it("keeps editor unavailable when defaults cannot load", async () => {
  h.defaults.mockRejectedValue(new Error("Project unavailable"));
  await render();
  expect(host.textContent).toContain("Project unavailable");
  expect(host.querySelector("input")).toBeNull();
});
it("does not request defaults for a non-manager", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(h.defaults).not.toHaveBeenCalled();
});
it("ignores defaults returned after account changes", async () => {
  let finish!: (value: unknown) => void;
  h.defaults.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  expect(host.querySelector("input")).toBeNull();
  h.generation = 2;
  await act(async () => finish({ cycle: null, workflow: null }));
  expect(host.querySelector("input")).toBeNull();
});

it("preserves the implicit cycle when choosing server default workflow", async () => {
  h.defaults.mockResolvedValue({
    cycle: { id: "44444444-4444-4444-8444-444444444444", name: "Next cycle" },
    workflow: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Active shots",
      semantic: "in_progress",
      crewId: "crew",
      archived: false,
    },
  });
  await render();
  await act(async () => button("Active shots")!.click());
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  await act(async () => type(0, "Shot"));
  h.update.mockResolvedValue({ id: "created" });
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update.mock.calls[0]?.[1]).toMatchObject({
    cycleId: "44444444-4444-4444-8444-444444444444",
  });
  expect(h.update.mock.calls[0]?.[1].workflowStateId).toBeUndefined();
});

it("preserves unfinished title and brief across backgrounding without submitting", async () => {
  await render();
  await act(async () => {
    type(0, "Unstaged title");
    type(1, "Unstaged brief");
  });
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(host.querySelectorAll("input")[0]!.value).toBe("Unstaged title");
  expect(host.querySelectorAll("input")[1]!.value).toBe("Unstaged brief");
  expect(h.update).not.toHaveBeenCalled();
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});

it("reopens a staged draft, preserves unchanged metadata and saves through staging only", async () => {
  const onStage = vi.fn();
  const initial = {
    positionRole: "Storyboard artist",
    requiredSkills: ["Editing"],
    title: "Reviewed draft",
    description: "Keep this",
    priority: "high" as const,
    startAt: "2026-09-30T01:02:03.456Z",
    dueAt: null,
    parentId: null,
    blockedByTaskIds: [],
    assignees: [],
    estimatePoints: 8,
    revisionLimit: 2,
    taskKind: "script" as const,
  };
  await act(async () =>
    root.render(
      <TaskCreate
        crewId="crew"
        userId="1"
        generation={1}
        initialDraft={{
          id: 7,
          kind: "task",
          state: "staged",
          input: initial,
          review: { context: [], assignees: [], customFields: [] },
        }}
        onStage={onStage}
        onCreated={h.refresh}
        onClose={h.refresh}
      />
    )
  );
  expect(host.querySelectorAll("input")[0]?.value).toBe("Reviewed draft");
  await act(async () => {
    type(0, "Edited draft");
  });
  await act(async () => button("taskWorkbench.saveDraft")!.click());
  expect(onStage).toHaveBeenCalledOnce();
  expect(onStage.mock.calls[0][0]).toMatchObject({ ...initial, title: "Edited draft" });
  expect(h.update).not.toHaveBeenCalled();
});

it("creates exact USD and percentage terms and rejects excessive precision", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => {
    type(0, "Task");
    type(6, "123.45");
    type(7, "1.255");
  });
  expect(button("taskCreate.submit")!.disabled).toBe(true);
  await act(async () => type(7, "1.25"));
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({ rewardUsdMinor: 12345, profitShareBps: 125 })
  );
});
it("keeps an expired form editable and rejects a deadline that passes while the form is open", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2029-01-01T00:00:00Z"));
  try {
    await render();
    await act(async () => {
      type(0, "Task");
      type(3, "2028-01-01 10:00");
    });
    expect(button("taskCreate.submit")!.disabled).toBe(true);
    expect(host.textContent).toContain("taskCreate.deadlinePast");
    await act(async () => type(3, "2030-01-01 10:00"));
    expect(button("taskCreate.submit")!.disabled).toBe(false);
    clock.mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
    await act(async () => button("taskCreate.submit")!.click());
    expect(h.update).not.toHaveBeenCalled();
    expect(host.querySelector("input")!.disabled).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

it("preserves explicitly cleared draft context and resets context for a new task", async () => {
  const workflow = {
    id: "33333333-3333-4333-8333-333333333333",
    crewId: "crew",
    name: "Default workflow",
    semantic: "open" as const,
    archived: false,
  };
  h.defaults.mockResolvedValue({ cycle: null, workflow });
  const stage = vi.fn();
  await act(async () =>
    root.render(
      <TaskCreate
        crewId="crew"
        userId="1"
        generation={1}
        initialParent={{
          id: "22222222-2222-4222-8222-222222222222",
          number: 2,
          title: "Old parent",
        }}
        initialDraft={{
          id: 7,
          kind: "task",
          state: "staged",
          input: {
            title: "Existing draft",
            description: "Brief",
            priority: "normal",
            startAt: null,
            dueAt: null,
            parentId: null,
            blockedByTaskIds: [],
            assignees: [],
          },
          review: {
            context: [],
            assignees: [],
            customFields: [],
            editor: {
              planning: { cycle: null, episode: null, labels: [] },
              workflow: null,
              parent: null,
              blockers: [],
              assignees: [],
            },
          },
        }}
        onStage={stage}
        onCreated={h.refresh}
        onClose={h.refresh}
      />
    )
  );
  expect(host.textContent).not.toContain("Old parent");
  await act(async () => button("taskWorkbench.saveDraft")!.click());
  expect(stage.mock.calls[0][0].workflowStateId).toBeUndefined();
  expect(stage.mock.calls[0][0].parentId).toBeNull();
  await render();
  expect(host.querySelector("input")!.value).toBe("");
  expect(host.textContent).toContain("Default workflow");
  h.update.mockResolvedValue({ id: "new" });
  await act(async () => type(0, "Fresh task"));
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({
      title: "Fresh task",
      description: "",
      workflowStateId: workflow.id,
      parentId: null,
      blockedByTaskIds: [],
      assignees: [],
    })
  );
});

it("restores older draft selections after a failed lookup and retry", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const onStage = vi.fn();
  h.planning.mockRejectedValueOnce(Error("Options offline"));
  await act(async () =>
    root.render(
      <TaskCreate
        crewId="crew"
        userId="1"
        generation={1}
        initialDraft={{
          id: 9,
          kind: "task",
          state: "staged",
          input: {
            title: "Older draft",
            description: "Keep context",
            priority: "normal",
            startAt: null,
            dueAt: null,
            parentId: null,
            blockedByTaskIds: [],
            assignees: [],
            episodeId: id,
            cycleId: id,
            labelIds: [id],
            workflowStateId: "33333333-3333-4333-8333-333333333333",
          },
          review: { context: [], assignees: [], customFields: [] },
        }}
        onStage={onStage}
        onCreated={h.refresh}
        onClose={h.refresh}
      />
    )
  );
  expect(host.textContent).toContain("Options offline");
  expect(host.querySelector("input")).toBeNull();
  await act(async () => button("inbox.retry")!.click());
  expect(host.querySelector("input")!.value).toBe("Older draft");
  await act(async () => button("taskWorkbench.saveDraft")!.click());
  expect(onStage.mock.calls[0][0]).toMatchObject({
    episodeId: id,
    cycleId: id,
    labelIds: [id],
    workflowStateId: "33333333-3333-4333-8333-333333333333",
  });
  expect(onStage.mock.calls[0][1].editor.planning.episode.id).toBe(id);
  expect(h.update).not.toHaveBeenCalled();
});

it("retains unstaged text while permission refresh suspends all editor controls", async () => {
  await render();
  await act(async () => type(0, "Unstaged title"));
  h.suspended = true;
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector("button")).toBeNull();
  h.suspended = false;
  await render();
  expect(host.querySelector("input")!.value).toBe("Unstaged title");
  expect(h.update).not.toHaveBeenCalled();
});

it("keeps a child-task draft through backgrounding and refreshed parent context", async () => {
  const parent: TaskDetail = {
    id: "11111111-1111-4111-8111-111111111111",
    crewId: "crew",
    number: 7,
    title: "Parent storyboard",
    description: "",
    status: "open",
    version: 1,
    priority: "normal",
    workflowState: { name: "Open" },
    revisionLimit: null,
    revisionRoundsUsed: 0,
    startAt: null,
    dueAt: null,
    parent: null,
    children: [],
    blockedBy: [],
    blocking: [],
    labels: [],
    assignees: [],
    submissions: [],
  };
  h.childContext.mockImplementation(async (task: TaskDetail) => ({ parent: task }));
  const show = (task = parent) =>
    act(async () =>
      root.render(
        <TaskChildCreate
          task={task}
          userId="1"
          generation={1}
          onCreated={h.refresh}
          onClose={h.refresh}
        />
      )
    );
  await show();
  await act(async () => {
    type(0, "Child draft");
    type(1, "Keep the detailed brief");
  });
  h.active = false;
  await show();
  expect(host.querySelector("input")).toBeNull();
  h.active = true;
  await show({ ...parent, version: 2, title: "Updated parent" });
  expect(host.querySelectorAll("input")[0]!.value).toBe("Child draft");
  expect(host.querySelectorAll("input")[1]!.value).toBe("Keep the detailed brief");
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({
      parentId: parent.id,
      title: "Child draft",
      description: "Keep the detailed brief",
    })
  );
});

it("keeps a rejected incomplete creation editable without an uncertain-write warning", async () => {
  h.update.mockRejectedValue(new TaskCreationRequiredError("Missing deadline"));
  await render();
  await act(async () => type(0, "Task"));
  await act(async () => button("taskCreate.submit")!.click());
  expect(host.textContent).toContain("taskCreate.requiredFields");
  expect(host.textContent).not.toContain("taskCreate.uncertain");
  expect(button("taskCreate.submit")!.disabled).toBe(false);
  expect(host.querySelector("input")!.disabled).toBe(false);
});
