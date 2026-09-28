import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TaskProjectView, type TaskProjectViewProps } from "./task-project-views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({ locale: "en-US" }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => session.locale,
}));
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span role="img" aria-label={name} />,
}));
vi.mock("@/app/(site)/crews/_components/task-unread-marker", () => ({
  TaskUnreadMarker: ({ taskId }: { taskId: string }) => (
    <span role="status" data-task-id={taskId}>
      2 unread
    </span>
  ),
}));
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
  session.locale = "en-US";
});
it.each(["list", "board"])("shows every assignee name alongside avatars in %s", async (layout) => {
  const props = propsFor(layout);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<TaskProjectView {...props} />));
  for (const name of ["Alice", "Bob"]) {
    expect(el.textContent).toContain(name);
    expect(el.querySelector(`[role="img"][aria-label="${name}"]`)).not.toBeNull();
  }
});

function propsFor(layout: string): TaskProjectViewProps {
  return {
    tasks: [
      {
        id: "task",
        number: 1,
        title: "Example task",
        createdAt: "2026-09-10T00:00:00Z",
        workflowStateId: "todo",
        priority: "normal",
        labels: [],
        assignees: [{ userId: "one" }, { userId: "two" }],
        fieldValues: [],
        subTaskCount: 0,
      },
    ],
    view: {
      layout,
      filters: {},
      visibleFields: ["assignees"],
      groupBy: null,
      showEmptyGroups: true,
    },
    workflowStates: [
      {
        id: "todo",
        name: "Todo",
        color: "#ffffff",
        semantic: "todo",
        position: 0,
        archived: false,
      },
    ],
    cycles: [],
    fields: [],
    displays: new Map([
      ["one", { name: "Alice", nickname: "Alice" }],
      ["two", { name: "Bob", nickname: "Bob" }],
    ]),
    selectedIds: new Set(),
    canManage: false,
    onToggleSelected: vi.fn(),
    onToggleAll: vi.fn(),
    onOpenTask: vi.fn(),
    onQuickUpdate: vi.fn(),
    onMoveTask: vi.fn(),
    onCreateWorkflowState: vi.fn(),
    onEditWorkflowState: vi.fn(),
    onCreateTask: vi.fn(),
  } as unknown as TaskProjectViewProps;
}

it.each(["list", "board"])("shows the configured cycle only when enabled in %s", async (layout) => {
  const props = propsFor(layout);
  props.tasks[0]!.cycle = {
    id: "cycle",
    name: "Episode 2 · Delivery",
  } as TaskProjectViewProps["tasks"][number]["cycle"];
  props.view.visibleFields = ["cycle"];
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<TaskProjectView {...props} />));
  expect(el.textContent).toContain("Episode 2 · Delivery");
  props.view = { ...props.view, visibleFields: [] };
  await act(async () => root.render(<TaskProjectView {...props} />));
  expect(el.textContent).not.toContain("Episode 2 · Delivery");
});

it.each(["zh-CN", "zh-HK"])(
  "formats list deadlines using the selected %s locale",
  async (locale) => {
    session.locale = locale;
    const props = propsFor("list");
    const dueAt = "2026-10-15T12:00:00Z";
    props.tasks[0]!.dueAt = dueAt;
    props.view.visibleFields = ["dueAt"];
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () => root.render(<TaskProjectView {...props} />));
    expect(el.textContent).toContain(
      new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(dueAt))
    );
  }
);

it.each(["list", "board"])("shows the task unread marker in %s", async (layout) => {
  const props = propsFor(layout);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<TaskProjectView {...props} />));
  expect(el.querySelector('[role="status"]')?.getAttribute("data-task-id")).toBe("task");
});

it.each([
  ["list", true],
  ["list", false],
  ["board", false],
] as const)("respects management access in %s (empty=%s)", async (layout, empty) => {
  const props = propsFor(layout);
  if (empty) props.tasks = [];
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  const managementButtons = () =>
    Array.from(el.querySelectorAll("button")).filter((button) =>
      ["newIssue", "addIssue", "editWorkflowColumn"].includes(
        button.getAttribute("aria-label") ?? button.textContent ?? ""
      )
    );
  await act(async () => root.render(<TaskProjectView {...props} canManage={false} />));
  expect(managementButtons()).toHaveLength(0);
  if (empty) expect(el.textContent).toContain("noIssues");
  else {
    const taskButton = Array.from(el.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Example task")
    );
    expect(taskButton).toBeDefined();
    await act(async () => taskButton!.click());
    expect(props.onOpenTask).toHaveBeenCalledWith("task");
  }
  await act(async () => root.render(<TaskProjectView {...props} canManage />));
  expect(managementButtons().length).toBeGreaterThan(0);
  await act(async () => managementButtons()[0]!.click());
  expect(layout === "board" ? props.onEditWorkflowState : props.onCreateTask).toHaveBeenCalled();
  await act(async () => root.render(<TaskProjectView {...props} canManage={false} />));
  expect(managementButtons()).toHaveLength(0);
});
