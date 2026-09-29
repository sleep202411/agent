import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskBrief } from "./task-brief";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ access: vi.fn(), update: vi.fn(), refresh: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-brief-api", async (original) => ({
  ...(await original<typeof import("./task-brief-api")>()),
  updateTaskBrief: h.update,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
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
    root.render(<TaskBrief task={value} userId="1" generation={1} onRefresh={h.refresh} />)
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
  h.access.mockResolvedValue({ allowed: false, canManage: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("uses manager permission rather than comment permission and hides closed-task editing", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskBrief.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskBrief.edit")).toBeDefined();
  for (const status of ["approved", "cancelled"]) {
    await render({ ...task, status });
    expect(host.textContent).toBe("");
  }
});
it("requires a changed, nonblank title; cancelling discards the unsaved draft", async () => {
  await render();
  await act(async () => button("taskBrief.edit")!.click());
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => type(0, " "));
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => type(0, "New"));
  expect(button("taskBrief.save")!.disabled).toBe(false);
  await act(async () => button("myServices.cancel")!.click());
  await act(async () => button("taskBrief.edit")!.click());
  expect(host.querySelector("input")!.value).toBe("Shot");
  expect(h.update).not.toHaveBeenCalled();
});
it("guards duplicate saves and submits the captured version and trimmed brief", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskBrief.edit")!.click());
  await act(async () => type(1, " Updated "));
  await act(async () => {
    button("taskBrief.save")!.click();
    button("taskBrief.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(task, {
    expectedVersion: 4,
    title: "Shot",
    description: "Updated",
  });
  expect(button("myServices.cancel")!.disabled).toBe(true);
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("preserves a conflicted draft and requires refresh before another attempt", async () => {
  h.update.mockRejectedValue(new Error("Task version changed"));
  await render();
  await act(async () => button("taskBrief.edit")!.click());
  await act(async () => type(0, "Changed"));
  await act(async () => button("taskBrief.save")!.click());
  expect(host.textContent).toContain("Task version changed");
  expect(host.querySelector("input")!.value).toBe("Changed");
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => button("myServices.cancel")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("suppresses completion after an account change", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskBrief.edit")!.click());
  await act(async () => type(0, "Changed"));
  await act(async () => button("taskBrief.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
it("aborts permission reads and ignores late account results", async () => {
  let finish!: (value: unknown) => void;
  h.access.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.access.mock.calls[0][2];
  h.generation = 2;
  await act(async () => finish({ canManage: true }));
  expect(button("taskBrief.edit")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
