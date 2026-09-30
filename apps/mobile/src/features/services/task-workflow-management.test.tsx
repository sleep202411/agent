import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskWorkflowManagement } from "./task-workflow-management";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
  archive: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-workflow-management-api", async (original) => ({
  ...(await original<typeof import("./task-workflow-management-api")>()),
  fetchManagedWorkflows: h.list,
  createManagedWorkflow: h.create,
  updateManagedWorkflow: h.update,
  deleteManagedWorkflow: h.remove,
  setWorkflowArchived: h.archive,
  reorderManagedWorkflows: h.reorder,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const label = {
  id: "00000000-0000-4000-8000-000000000001",
  crewId: "crew",
  name: "Art",
  semantic: "in_progress",
  systemKey: null,
  archived: false,
  position: 0,
  version: 2,
  taskCount: 0,
  color: "#AABBCC",
  updatedAt: "2026-09-30T00:00:00.000Z",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <TaskWorkflowManagement crewId="crew" userId="1" generation={1} onClose={h.close} />
    )
  );
const type = (index: number, value: string) =>
  act(async () => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.list.mockResolvedValue([label]);
  h.create.mockResolvedValue(label);
  h.update.mockResolvedValue(label);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("withholds management when permission fails and retries fresh", async () => {
  h.list.mockRejectedValue(new Error("Permission denied"));
  await render();
  expect(button("taskWorkflowManagement.add")).toBeUndefined();
  h.list.mockResolvedValue([label]);
  await click("thread.refresh");
  expect(button("taskWorkflowManagement.add")).toBeTruthy();
});
it("creates with chosen workflow status and insertion anchor", async () => {
  await render();
  await click("taskWorkflowManagement.add");
  expect(button("taskLabels.save")?.disabled).toBe(true);
  await type(0, "Next");
  await click("taskWorkflowManagement.approved");
  await click("Art");
  await click("taskLabels.save");
  expect(h.create).toHaveBeenCalledWith("crew", "1", 1, {
    name: "Next",
    color: "#E52227",
    semantic: "approved",
    afterStateId: label.id,
  });
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("edits settings without exposing semantic mutation", async () => {
  await render();
  await click("Art · taskWorkflowManagement.active · 0");
  expect(button("taskLabels.save")?.disabled).toBe(true);
  expect(button("taskWorkflowManagement.approved")).toBeUndefined();
  await type(0, "Next");
  await click("taskLabels.save");
  expect(h.update).toHaveBeenCalledWith(label, "1", 1, { name: "Next", color: "#AABBCC" });
});
it("requires a same-status replacement and explicit archive confirmation", async () => {
  const source = { ...label, taskCount: 3 };
  const next = { ...label, id: "00000000-0000-4000-8000-000000000002", name: "Next", position: 1 };
  h.list.mockResolvedValue([
    source,
    next,
    {
      ...next,
      id: "00000000-0000-4000-8000-000000000003",
      name: "Approved",
      semantic: "approved",
      position: 2,
    },
  ]);
  await render();
  await click("Art · taskWorkflowManagement.active · 3");
  await click("taskWorkflowManagement.archive");
  expect(h.archive).not.toHaveBeenCalled();
  expect(button("taskWorkflowManagement.confirmArchive")?.disabled).toBe(true);
  expect(button("Approved")).toBeUndefined();
  await click("Next");
  await click("taskWorkflowManagement.confirmArchive");
  expect(h.archive).toHaveBeenCalledWith(source, "1", 1, true, next.id);
});
it("keeps last active column and order boundaries disabled", async () => {
  await render();
  await click("Art · taskWorkflowManagement.active · 0");
  for (const key of ["archive", "up", "down"])
    expect(button("taskWorkflowManagement." + key)?.disabled).toBe(true);
});
it("moves a column with the complete captured active order", async () => {
  const next = { ...label, id: "00000000-0000-4000-8000-000000000002", name: "Next", position: 1 };
  h.list.mockResolvedValue([label, next]);
  await render();
  await click("Art · taskWorkflowManagement.active · 0");
  await click("taskWorkflowManagement.down");
  expect(h.reorder).toHaveBeenCalledWith("crew", "1", 1, [next, label]);
});
it("restores built-in columns but never offers deletion", async () => {
  const row = { ...label, archived: true, systemKey: "in_progress" };
  h.list.mockResolvedValue([row]);
  await render();
  await click("Art · taskWorkflowManagement.archived · 0");
  expect(button("taskLabels.delete")).toBeUndefined();
  await click("taskWorkflowManagement.restore");
  expect(h.archive).toHaveBeenCalledWith(row, "1", 1, false, undefined);
});
it("confirms deletion of an archived custom column", async () => {
  const row = { ...label, archived: true };
  h.list.mockResolvedValue([row]);
  await render();
  await click("Art · taskWorkflowManagement.archived · 0");
  await click("taskLabels.delete");
  expect(h.remove).not.toHaveBeenCalled();
  await click("taskLabels.confirmDelete");
  expect(h.remove).toHaveBeenCalledWith(row, "1", 1);
});
it("blocks duplicate submission and requires fresh read after failure", async () => {
  h.create.mockRejectedValue(new Error("Uncertain response"));
  await render();
  await click("taskWorkflowManagement.add");
  await type(0, "Next");
  await act(async () => {
    button("taskLabels.save")!.click();
    button("taskLabels.save")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(button("taskLabels.save")?.disabled).toBe(true);
  expect(host.textContent).toContain("taskWorkflowManagement.recheck");
  await click("crewTasks.back");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("aborts reads and ignores account-switched results", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.list.mock.calls[0]?.[3] as AbortSignal;
  h.generation = 2;
  await act(async () => finish([label]));
  expect(button("taskWorkflowManagement.add")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
