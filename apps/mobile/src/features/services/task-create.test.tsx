import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCreate } from "./task-create";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  defaults: vi.fn(),
  fields: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  workflows: vi.fn(),
  planning: vi.fn(),
  templates: vi.fn(),
  generation: 1,
}));
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

it("creates a task with selected cycle, episode and labels", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  for (const kind of ["cycle", "episode", "labels"]) {
    await act(async () =>
      button(`taskPlanning.${kind}${kind === "labels" ? " · 0/20" : ""}`)!.click()
    );
    await act(async () => button(`Pick ${kind}`)!.click());
  }
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update).toHaveBeenCalledWith(
    "crew",
    expect.objectContaining({
      cycleId: "44444444-4444-4444-8444-444444444444",
      episodeId: "44444444-4444-4444-8444-444444444444",
      labelIds: ["44444444-4444-4444-8444-444444444444"],
    })
  );
});
it("clears planning choices and prevents duplicate label selection", async () => {
  h.update.mockResolvedValue({ id: "new" });
  await render();
  await act(async () => type(0, "Task"));
  for (const kind of ["cycle", "episode", "labels"]) {
    await act(async () =>
      button(`taskPlanning.${kind}${kind === "labels" ? " · 0/20" : ""}`)!.click()
    );
    await act(async () => button(`Pick ${kind}`)!.click());
  }
  await act(async () => button("taskPlanning.labels · 1/20")!.click());
  expect(button("Pick labels")!.disabled).toBe(true);
  await act(async () => button("common.cancel")!.click());
  await act(async () => button("Pick labels ×")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
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
  await act(async () => button("taskPlanning.cycle")!.click());
  h.generation = 2;
  await act(async () =>
    finish([{ id: "44444444-4444-4444-8444-444444444444", name: "Private Cycle" }])
  );
  expect(host.textContent).not.toContain("Private Cycle");
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
  expect(host.textContent).toContain("Next cycle");
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

it("lets the creator clear default cycle and choose server default workflow", async () => {
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
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => button("Active shots")!.click());
  await act(async () => button("taskCreate.defaultWorkflow")!.click());
  await act(async () => type(0, "Shot"));
  h.update.mockResolvedValue({ id: "created" });
  await act(async () => button("taskCreate.submit")!.click());
  expect(h.update.mock.calls[0]?.[1]).toMatchObject({ cycleId: null });
  expect(h.update.mock.calls[0]?.[1].workflowStateId).toBeUndefined();
});
