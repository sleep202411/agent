import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskClosure } from "./task-closure";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ access: vi.fn(), close: vi.fn(), refresh: vi.fn(), generation: 1 }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000002" },
}));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-closure-api", async (original) => ({
  ...(await original<typeof import("./task-closure-api")>()),
  closeTask: h.close,
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key);
const click = async (key: string) => {
  await act(async () => button(key)!.click());
};
const render = async (value = task) => {
  await act(async () =>
    root.render(<TaskClosure task={value} userId="manager" generation={1} onRefresh={h.refresh} />)
  );
};
const type = async (value: string) => {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.close.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each(["submitted", "approved", "cancelled"])("hides cancellation for %s", async (status) => {
  await render({ ...task, status });
  expect(button("taskClosure.title")).toBeUndefined();
});
it("requires manager access", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(button("taskClosure.title")).toBeUndefined();
});
it("requires reason and explicit confirmation", async () => {
  await render();
  await click("taskClosure.title");
  expect(button("taskClosure.confirm")!.disabled).toBe(true);
  await type("No longer needed");
  expect(h.close).not.toHaveBeenCalled();
  await click("taskClosure.confirm");
  expect(h.close).toHaveBeenCalledWith(task, "manager", 1, {
    requestId: "00000000-0000-4000-8000-000000000002",
    expectedVersion: task.version,
    reason: "No longer needed",
  });
  expect(host.textContent).toContain("taskClosure.done");
  await click("thread.refresh");
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("keeps retries identical after uncertain response", async () => {
  h.close.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await click("taskClosure.confirm");
  expect(host.querySelector("input")).toBeNull();
  await click("taskClosure.retry");
  expect(h.close.mock.calls[1]).toEqual(h.close.mock.calls[0]);
});
it("requires refresh after definite conflict", async () => {
  h.close.mockRejectedValue(Object.assign(new Error("stale"), { status: 409 }));
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await click("taskClosure.confirm");
  expect(button("taskClosure.retry")).toBeUndefined();
  expect(button("thread.refresh")).toBeDefined();
});
it("blocks drafts when task version changes", async () => {
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await render({ ...task, version: task.version + 1 });
  expect(button("taskClosure.confirm")!.disabled).toBe(true);
  expect(h.close).not.toHaveBeenCalled();
});
it("can discard without a write", async () => {
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await click("common.cancel");
  expect(h.close).not.toHaveBeenCalled();
});
it("locks duplicate confirmations", async () => {
  let resolve!: (v: object) => void;
  h.close.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await act(async () => {
    button("taskClosure.confirm")!.click();
    button("taskClosure.confirm")!.click();
  });
  expect(h.close).toHaveBeenCalledOnce();
  expect(button("common.cancel")!.disabled).toBe(true);
  await act(async () => resolve({}));
});
it("blocks stale account action", async () => {
  await render();
  await click("taskClosure.title");
  await type("Reason");
  h.generation = 2;
  await click("taskClosure.confirm");
  expect(h.close).not.toHaveBeenCalled();
});

it("retains recovery identity when the task becomes cancelled", async () => {
  h.close.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await click("taskClosure.confirm");
  await render({ ...task, version: task.version + 1, status: "cancelled" });
  await click("taskClosure.retry");
  expect(h.close.mock.calls[1][3]).toEqual(h.close.mock.calls[0][3]);
});
it("suppresses success after an account change", async () => {
  let resolve!: (v: object) => void;
  h.close.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  await click("taskClosure.title");
  await type("Reason");
  await click("taskClosure.confirm");
  h.generation = 2;
  await act(async () => resolve({}));
  expect(host.textContent).not.toContain("taskClosure.done");
});
