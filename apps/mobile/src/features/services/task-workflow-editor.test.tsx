import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskWorkflowEditor } from "./task-workflow-editor";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  workflows: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-workflow-api", async (original) => ({
  ...(await original<typeof import("./task-workflow-api")>()),
  fetchManualTaskWorkflows: h.workflows,
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-workflow-edit-api", async (original) => ({
  ...(await original<typeof import("./task-workflow-edit-api")>()),
  moveTaskWorkflow: h.update,
  fetchTaskWorkflow: h.fetch,
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
const task: TaskDetail = {
  id: "task",
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Brief",
  version: 4,
  status: "open",
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [],
  submissions: [],
};
let host: HTMLDivElement, root: Root;
const render = (value = task) =>
  act(async () =>
    root.render(<TaskWorkflowEditor task={value} userId="1" generation={1} onRefresh={h.refresh} />)
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue({
    ...task,
    workflowStateId: "11111111-1111-4111-8111-111111111111",
    workflowState: {
      id: "11111111-1111-4111-8111-111111111111",
      crewId: "crew",
      name: "Open",
      semantic: "open",
      archived: false,
    },
  });
  h.workflows.mockResolvedValue([
    {
      id: "22222222-2222-4222-8222-222222222222",
      crewId: "crew",
      name: "Working",
      semantic: "in_progress",
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

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const choose = async () => {
  await act(async () => button("Open")!.click());
  expect(button("taskCreate.defaultWorkflow")).toBeUndefined();
  await act(async () => button("Working")!.click());
};
it("requires management permission and hides review and closed task moves", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskWorkflow.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskWorkflow.edit")).toBeDefined();
  for (const status of ["submitted", "approved", "cancelled"]) {
    await render({ ...task, status });
    expect(host.textContent).toBe("");
  }
});
it("saves an explicit new column only once using the captured snapshot", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  expect(button("taskWorkflow.save")!.disabled).toBe(true);
  await choose();
  await act(async () => {
    button("taskWorkflow.save")!.click();
    button("taskWorkflow.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ version: 4 }),
    expect.objectContaining({ name: "Working", semantic: "in_progress" })
  );
  expect(button("myServices.cancel")!.disabled).toBe(true);
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("does not allow moving when the current snapshot has changed", async () => {
  h.fetch.mockRejectedValue(new Error("Task changed"));
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  expect(host.textContent).toContain("Task changed");
  expect(button("taskWorkflow.save")).toBeUndefined();
});
it("discards unsaved choices on cancel", async () => {
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  await choose();
  await act(async () => button("myServices.cancel")!.click());
  await act(async () => button("taskWorkflow.edit")!.click());
  expect(button("Open")).toBeDefined();
  expect(h.update).not.toHaveBeenCalled();
});
it("freezes a failed move until refreshing", async () => {
  h.update.mockRejectedValue(new Error("Task version changed"));
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  await choose();
  await act(async () => button("taskWorkflow.save")!.click());
  expect(host.textContent).toContain("Task version changed");
  expect(button("taskWorkflow.save")!.disabled).toBe(true);
  await act(async () => button("myServices.cancel")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("ignores completion after account changes", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  await choose();
  await act(async () => button("taskWorkflow.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
it("aborts workflow snapshot reads when leaving", async () => {
  h.fetch.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => button("taskWorkflow.edit")!.click());
  const signal = h.fetch.mock.calls[0]![1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
