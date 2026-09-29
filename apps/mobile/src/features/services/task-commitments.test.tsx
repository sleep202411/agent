import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCommitments } from "./task-commitments";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  access: vi.fn(),
  set: vi.fn(),
  close: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("./task-commitment-api", () => ({
  fetchTaskCommitments: h.fetch,
  setTaskCommitment: h.set,
  closeTaskHandover: h.close,
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
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
    <button disabled={disabled} onClick={onPress}>
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
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const task: TaskDetail = {
  id: "task",
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "",
  submissions: [],
  version: 4,
  status: "in_progress",
  workflowState: { name: "Doing" },
  startAt: null,
  dueAt: "2099-10-01T00:00:00Z",
  labels: [],
  assignees: [{ id: "assignment", userId: "1" }],
};
const record = {
  id: "record",
  taskId: "task",
  assignmentId: "assignment",
  userId: "1",
  status: "accepted",
  acceptedAt: "2026-09-29T00:00:00Z",
  promisedDueAt: "2099-10-01T00:00:00Z",
  releasedAt: null,
  handoverNote: null,
  reason: "",
  currentAssignment: true,
  overdue: false,
  deadlineChanged: false,
};
let host: HTMLDivElement, root: Root;
const render = (value = task) =>
  act(async () =>
    root.render(<TaskCommitments task={value} userId="1" generation={1} onRefresh={h.refresh} />)
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
const type = (text: string) => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue([]);
  h.access.mockResolvedValue({ canManage: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("accepts once at the displayed version and refreshes after success", async () => {
  let finish!: () => void;
  h.set.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  expect(host.textContent).toContain("taskCommitment.pending");
  await act(async () => {
    button("taskCommitment.accept")!.click();
    button("taskCommitment.accept")!.click();
  });
  expect(h.set).toHaveBeenCalledExactlyOnceWith("task", "1", {
    expectedVersion: 4,
    action: "accept",
    reason: "",
  });
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("hides changes for unassigned/review tasks and requires a future acceptance deadline", async () => {
  await render({ ...task, assignees: [] });
  expect(button("taskCommitment.accept")).toBeUndefined();
  await render({ ...task, status: "submitted" });
  expect(button("taskCommitment.accept")).toBeUndefined();
  await render({ ...task, dueAt: null });
  expect(button("taskCommitment.accept")!.disabled).toBe(true);
  expect(host.textContent).toContain("taskCommitment.futureDeadline");
});
it("requires reasons for risk and withdrawal and freezes uncertain actions", async () => {
  h.fetch.mockResolvedValue([record]);
  h.set.mockRejectedValue(new Error("Task changed"));
  await render();
  expect(button("taskCommitment.accept")).toBeUndefined();
  expect(button("taskCommitment.reportRisk")!.disabled).toBe(true);
  await act(async () => type("Delivery delayed"));
  await act(async () => button("taskCommitment.reportRisk")!.click());
  expect(h.set).toHaveBeenCalledWith("task", "1", {
    expectedVersion: 4,
    action: "at_risk",
    reason: "Delivery delayed",
  });
  expect(host.textContent).toContain("Task changed");
  expect(button("taskCommitment.withdrawTask")).toBeUndefined();
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("offers handover only to task managers for former assignments", async () => {
  h.fetch.mockResolvedValue([{ ...record, currentAssignment: false }]);
  h.access.mockResolvedValue({ canManage: true });
  h.close.mockResolvedValue({});
  await render();
  expect(button("taskCommitment.closeHandover")!.disabled).toBe(true);
  await act(async () => type("Source files transferred"));
  await act(async () => button("taskCommitment.closeHandover")!.click());
  expect(h.close).toHaveBeenCalledWith("task", "record", "Source files transferred");
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("clears unavailable controls and ignores stale member/commitment loads", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.fetch.mock.calls[0][1];
  h.generation = 2;
  await act(async () => finish([record]));
  expect(host.textContent).not.toContain("taskCommitment.accepted");
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("does not offer handover to ordinary members or actions on withdrawn assignments", async () => {
  h.fetch.mockResolvedValue([{ ...record, status: "withdrawn" }]);
  await render();
  expect(button("taskCommitment.accept")).toBeUndefined();
  expect(button("taskCommitment.withdrawTask")).toBeUndefined();
  expect(button("taskCommitment.closeHandover")).toBeUndefined();
});
it("disables acceptance when the displayed deadline passes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T00:00:00Z"));
  try {
    await render({ ...task, dueAt: "2026-09-29T00:00:01Z" });
    expect(button("taskCommitment.accept")!.disabled).toBe(false);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button("taskCommitment.accept")!.disabled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("suppresses a commitment completion after account replacement", async () => {
  let finish!: () => void;
  h.set.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskCommitment.accept")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
