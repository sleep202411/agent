import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskChildButton, TaskChildCreate } from "./task-child-create";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  generation: 1,
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-child-context", () => ({ fetchTaskChildContext: h.fetch }));
vi.mock("./task-create", () => ({
  TaskCreate: (props: unknown) => {
    h.create(props);
    return <span>child form</span>;
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
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
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.fetch.mockResolvedValue({ parent: task });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const renderButton = (value = task) =>
  act(async () =>
    root.render(<TaskChildButton task={value} userId="1" generation={1} onOpen={h.open} />)
  );
const renderForm = () =>
  act(async () =>
    root.render(
      <TaskChildCreate task={task} userId="1" generation={1} onCreated={h.open} onClose={h.close} />
    )
  );
it("allows managers, rejects stale clicks and hides from non-managers", async () => {
  await renderButton();
  expect(host.textContent).toContain("taskCreate.addSubtask");
  await act(async () => host.querySelector("button")!.click());
  expect(h.open).toHaveBeenCalledTimes(1);
  h.generation = 2;
  await act(async () => host.querySelector("button")!.click());
  expect(h.open).toHaveBeenCalledTimes(1);
});
it("hides creation for non-managers and closed parents", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await renderButton();
  expect(host.querySelector("button")).toBeNull();
  for (const status of ["approved", "cancelled"]) {
    await renderButton({ ...task, status });
    expect(host.querySelector("button")).toBeNull();
  }
});
it("passes fresh parent/workflow to the existing creation form", async () => {
  const workflow = { id: "workflow" };
  h.fetch.mockResolvedValue({ parent: task, workflow });
  await renderForm();
  expect(h.create).toHaveBeenCalledWith(
    expect.objectContaining({
      initialParent: task,
      initialWorkflow: workflow,
      closeLabel: "taskRelations.backToTask",
    })
  );
});
it("keeps a failed parent refresh out of the form and permits return", async () => {
  h.fetch.mockRejectedValue(new Error("Parent changed"));
  await renderForm();
  expect(host.textContent).toContain("Parent changed");
  expect(h.create).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("ignores context returned after account replacement", async () => {
  let resolve!: (value: unknown) => void;
  h.fetch.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  await renderForm();
  h.generation = 2;
  await act(async () => resolve({ parent: task }));
  expect(h.create).not.toHaveBeenCalled();
});
