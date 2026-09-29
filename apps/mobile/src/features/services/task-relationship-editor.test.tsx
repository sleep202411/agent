import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskRelationshipEditor } from "./task-relationship-editor";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ access: vi.fn(), update: vi.fn(), refresh: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-relationship-api", async (original) => ({
  ...(await original<typeof import("./task-relationship-api")>()),
  updateTaskRelationships: h.update,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
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
    root.render(
      <TaskRelationshipEditor task={value} userId="1" generation={1} onRefresh={h.refresh} />
    )
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
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
vi.mock("./task-picker", () => ({
  TaskPicker: ({
    onSelect,
    excludedIds,
  }: {
    onSelect: (item: unknown) => void;
    excludedIds: string[];
  }) => (
    <div>
      <span>{excludedIds.join(",")}</span>
      <button onClick={() => onSelect({ id: "other", number: 2, title: "Dependency" })}>
        pick task
      </button>
      <button onClick={() => onSelect({ id: "task", number: 1, title: "Self" })}>pick self</button>
    </div>
  ),
}));

it("requires manager permission and hides closed-task editing", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskRelationships.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskRelationships.edit")).toBeDefined();
  await render({ ...task, status: "approved" });
  expect(host.textContent).toBe("");
});
it("chooses parent and blocker, rejects self selection and guards duplicate saves", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskRelationships.edit")!.click());
  expect(button("taskRelationships.save")!.disabled).toBe(true);
  await act(async () => button("taskRelationships.chooseParent")!.click());
  await act(async () => button("pick self")!.click());
  expect(button("taskRelationships.save")!.disabled).toBe(true);
  await act(async () => button("pick task")!.click());
  await act(async () => button("taskRelationships.addBlocker")!.click());
  await act(async () => button("pick task")!.click());
  await act(async () => {
    button("taskRelationships.save")!.click();
    button("taskRelationships.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(task, {
    expectedVersion: 4,
    parentId: "other",
    blockedByTaskIds: ["other"],
  });
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("supports removing existing parent and blockers", async () => {
  const ref = {
    id: "other",
    number: 2,
    title: "Dependency",
    status: "open",
    workflowState: { name: "Open" },
    parentId: null,
  };
  const value = { ...task, parent: ref, blockedBy: [{ ...ref, resolved: false }] };
  h.update.mockResolvedValue({});
  await render(value);
  await act(async () => button("taskRelationships.edit")!.click());
  await act(async () => button("taskRelationships.removeParent")!.click());
  await act(async () => button("TASK-2 · Dependency ×")!.click());
  await act(async () => button("taskRelationships.save")!.click());
  expect(h.update).toHaveBeenCalledExactlyOnceWith(value, {
    expectedVersion: 4,
    parentId: null,
    blockedByTaskIds: [],
  });
});
it("keeps server cycle errors and requires refresh before retrying", async () => {
  h.update.mockRejectedValue(new Error("Circular dependency"));
  await render();
  await act(async () => button("taskRelationships.edit")!.click());
  await act(async () => button("taskRelationships.addBlocker")!.click());
  await act(async () => button("pick task")!.click());
  await act(async () => button("taskRelationships.save")!.click());
  expect(host.textContent).toContain("Circular dependency");
  expect(button("taskRelationships.save")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("ignores completion after account changes", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskRelationships.edit")!.click());
  await act(async () => button("taskRelationships.addBlocker")!.click());
  await act(async () => button("pick task")!.click());
  await act(async () => button("taskRelationships.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
