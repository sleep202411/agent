import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskAssignmentSession } from "./use-task-assignment-session";
import { TaskAssignments } from "./task-assignments";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-assignment-api", async (original) => ({
  ...(await original<typeof import("./task-assignment-api")>()),
  updateTaskAssignments: h.update,
  fetchTaskAssignments: h.fetch,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
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
    root.render(<TaskAssignments task={value} userId="1" generation={1} onRefresh={h.refresh} />)
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
  h.fetch.mockResolvedValue({
    ...task,
    assignees: [{ id: "assignment", userId: "1", currency: "USD", rewardAmountMinor: 12345 }],
  });
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
vi.mock("./user-displays", () => ({ useUserDisplays: () => undefined }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({
    onSelect,
  }: {
    onSelect: (m: { userId: string; label: string }) => void;
  }) => <button onClick={() => onSelect({ userId: "2", label: "Two" })}>pick</button>,
}));
it("requires manager access and hides closed tasks", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskAssignments.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskAssignments.edit")).toBeDefined();
  await render({ ...task, status: "approved" });
  expect(host.textContent).toBe("");
});
it("preserves existing paid assignments when adding another member and prevents duplicate saves", async () => {
  h.update.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => button("taskAssignments.edit")!.click());
  expect(host.querySelector("input")!.value).toBe("123.45");
  await act(async () => button("taskCreate.add")!.click());
  await act(async () => button("pick")!.click());
  await act(async () => {
    button("taskBrief.save")!.click();
    button("taskBrief.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 4 }), {
    expectedVersion: 4,
    assignees: [
      { userId: "1", currency: "USD", rewardAmountMinor: 12345 },
      { userId: "2", currency: "CNY", rewardAmountMinor: null },
    ],
  });
});
it("allows explicit reward removal but rejects invalid amounts", async () => {
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskAssignments.edit")!.click());
  await act(async () => type(0, "1.001"));
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => type(0, ""));
  await act(async () => button("taskBrief.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), {
    expectedVersion: 4,
    assignees: [{ userId: "1", currency: "USD", rewardAmountMinor: null }],
  });
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("shows server contract rejection and freezes the draft until refresh", async () => {
  h.update.mockRejectedValue(new Error("Contract assignment is locked"));
  await render();
  await act(async () => button("taskAssignments.edit")!.click());
  await act(async () => button("taskCreate.remove · 1")!.click());
  await act(async () => button("taskBrief.save")!.click());
  expect(host.textContent).toContain("Contract assignment is locked");
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("does not open a stale or incomplete assignment snapshot", async () => {
  h.fetch.mockRejectedValue(new Error("Task changed"));
  await render();
  await act(async () => button("taskAssignments.edit")!.click());
  expect(host.textContent).toContain("Task changed");
  expect(button("taskBrief.save")).toBeUndefined();
});
it("ignores save completion after switching accounts", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskAssignments.edit")!.click());
  await act(async () => type(0, "200"));
  await act(async () => button("taskBrief.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});

function RefreshingAssignments({ value, visible }: { value: TaskDetail; visible: boolean }) {
  const session = useTaskAssignmentSession(value.id, 1, h.refresh);
  return visible ? (
    <TaskAssignments
      key={value.version}
      task={value}
      userId="1"
      generation={1}
      onRefresh={h.refresh}
      session={session}
    />
  ) : null;
}
const refreshRender = (value = task, visible = true) =>
  act(async () => root.render(<RefreshingAssignments value={value} visible={visible} />));
it("retains selected contributors and rewards across reload, requiring explicit version review", async () => {
  await refreshRender();
  await act(async () => button("taskAssignments.edit")!.click());
  await act(async () => type(0, "150.50"));
  await act(async () => button("taskCreate.add")!.click());
  await act(async () => button("pick")!.click());
  await refreshRender(task, false);
  const latest = { ...(await h.fetch()), version: 5 };
  h.fetch.mockResolvedValue(latest);
  await refreshRender({ ...task, version: 5 });
  expect(host.querySelectorAll("input")[0]!.value).toBe("150.50");
  expect(host.querySelectorAll("input")).toHaveLength(2);
  expect(button("taskBrief.save")!.disabled).toBe(true);
  await act(async () => button("taskBrief.reviewLatest")!.click());
  await act(async () => button("taskBrief.save")!.click());
  expect(h.update).toHaveBeenCalledExactlyOnceWith(latest, {
    expectedVersion: 5,
    assignees: [
      { userId: "1", currency: "USD", rewardAmountMinor: 15050 },
      { userId: "2", currency: "CNY", rewardAmountMinor: null },
    ],
  });
});
it("retains pending assignment locks through refresh and preserves conflict details", async () => {
  let fail!: (e: Error) => void;
  h.update.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  await refreshRender();
  await act(async () => button("taskAssignments.edit")!.click());
  await act(async () => type(0, "150.50"));
  await act(async () => button("taskBrief.save")!.click());
  await refreshRender(task, false);
  h.fetch.mockResolvedValue({ ...(await h.fetch()) });
  await refreshRender({ ...task });
  expect(button("taskBrief.save")!.disabled).toBe(true);
  expect(button("myServices.cancel")!.disabled).toBe(true);
  expect(button("taskBrief.reviewLatest")).toBeUndefined();
  await act(async () => fail(new Error("Assignment conflict")));
  expect(host.textContent).toContain("Assignment conflict");
  expect(host.querySelector("input")!.value).toBe("150.50");
  await act(async () => button("taskBrief.reviewLatest")!.click());
  expect(button("taskBrief.save")!.disabled).toBe(false);
  expect(h.update).toHaveBeenCalledOnce();
});
