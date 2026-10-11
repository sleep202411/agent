import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskScheduleSession } from "./use-task-schedule-session";
import { TaskSchedule } from "./task-schedule";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ access: vi.fn(), update: vi.fn(), refresh: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-schedule-api", async (original) => ({
  ...(await original<typeof import("./task-schedule-api")>()),
  updateTaskSchedule: h.update,
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
    root.render(<TaskSchedule task={value} userId="1" generation={1} onRefresh={h.refresh} />)
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

it("requires manager permission and excludes closed-task editing", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskSchedule.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskSchedule.edit")).toBeDefined();
  for (const status of ["approved", "cancelled"]) {
    await render({ ...task, status });
    expect(host.textContent).toBe("");
  }
});
it("rejects invalid calendars and reversed dates, allowing cancellation without mutation", async () => {
  await render();
  await act(async () => button("taskSchedule.edit")!.click());
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  await act(async () => type(0, "2026-02-30 12:00"));
  expect(host.textContent).toContain("taskSchedule.invalid");
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  await act(async () => type(0, "2026-10-02 12:00"));
  await act(async () => type(1, "2026-10-01 12:00"));
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  await act(async () => type(1, "2026-10-03 12:00"));
  expect(button("taskSchedule.save")!.disabled).toBe(false);
  await act(async () => button("myServices.cancel")!.click());
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => button("taskSchedule.edit")!.click());
  expect(host.querySelector("input")!.value).toBe("");
});
it("guards duplicate saves and preserves original dates during priority changes", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  const value = { ...task, dueAt: "2026-10-01T12:30:45.123+08:00" };
  await render(value);
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => button("taskSchedule.urgent")!.click());
  await act(async () => {
    button("taskSchedule.save")!.click();
    button("taskSchedule.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(value, {
    expectedVersion: 4,
    priority: "urgent",
    startAt: null,
    dueAt: value.dueAt,
  });
  expect(button("myServices.cancel")!.disabled).toBe(true);
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("sends explicit null when a date is cleared", async () => {
  h.update.mockResolvedValue({});
  const value = { ...task, dueAt: "2026-10-01T00:00:00Z" };
  await render(value);
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => type(1, ""));
  await act(async () => button("taskSchedule.save")!.click());
  expect(h.update).toHaveBeenCalledExactlyOnceWith(value, {
    expectedVersion: 4,
    priority: "normal",
    startAt: null,
    dueAt: null,
  });
});
it("freezes conflicted writes and requires refresh before another attempt", async () => {
  h.update.mockRejectedValue(new Error("Task version changed"));
  await render();
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => button("taskSchedule.high")!.click());
  await act(async () => button("taskSchedule.save")!.click());
  expect(host.textContent).toContain("Task version changed");
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("suppresses mutation completion after an account change", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => button("taskSchedule.low")!.click());
  await act(async () => button("taskSchedule.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});

function RefreshingSchedule({ value, visible }: { value: TaskDetail; visible: boolean }) {
  const session = useTaskScheduleSession(value.id, 1, h.refresh);
  return visible ? (
    <TaskSchedule
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
  act(async () => root.render(<RefreshingSchedule value={value} visible={visible} />));
it("preserves dates and priority through refresh and explicitly reviews the new version", async () => {
  await refreshRender();
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => type(1, "2026-10-20 12:00"));
  await act(async () => button("taskSchedule.urgent")!.click());
  await refreshRender(task, false);
  const latest = { ...task, version: 5, priority: "low" as const };
  await refreshRender(latest);
  expect(host.querySelectorAll("input")[1]!.value).toBe("2026-10-20 12:00");
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  expect(host.textContent).toContain("taskSchedule.latest");
  await act(async () => button("taskBrief.reviewLatest")!.click());
  await act(async () => button("taskSchedule.save")!.click());
  expect(h.update).toHaveBeenCalledExactlyOnceWith(latest, {
    expectedVersion: 5,
    priority: "urgent",
    startAt: null,
    dueAt: new Date(2026, 9, 20, 12, 0).toISOString(),
  });
});
it("retains the pending save lock when its editor is remounted during refresh", async () => {
  let fail!: (e: Error) => void;
  h.update.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  await refreshRender();
  await act(async () => button("taskSchedule.edit")!.click());
  await act(async () => button("taskSchedule.high")!.click());
  await act(async () => button("taskSchedule.save")!.click());
  await refreshRender(task, false);
  await refreshRender({ ...task });
  expect(button("taskSchedule.save")!.disabled).toBe(true);
  expect(button("myServices.cancel")!.disabled).toBe(true);
  expect(button("taskBrief.reviewLatest")).toBeUndefined();
  await act(async () => fail(new Error("Schedule conflict")));
  expect(host.textContent).toContain("Schedule conflict");
  expect(h.update).toHaveBeenCalledOnce();
  await act(async () => button("taskBrief.reviewLatest")!.click());
  expect(button("taskSchedule.save")!.disabled).toBe(false);
  expect(h.update).toHaveBeenCalledOnce();
});
