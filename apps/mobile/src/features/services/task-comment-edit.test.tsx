import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCommentEdit } from "./task-comment-edit";
import type { TaskActivity } from "./task-timeline-api";
const h = vi.hoisted(() => ({
  edit: vi.fn(),
  saved: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
  active: true,
}));
vi.mock("./task-comment-api", () => ({ editTaskComment: h.edit }));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({ onSelect }: { onSelect: (v: unknown) => void }) => (
    <button onClick={() => onSelect({ userId: "3", label: "New" })}>pick</button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const item: TaskActivity = {
  id: "comment",
  taskId: "task",
  kind: "comment",
  actorUserId: "1",
  body: "Hi @Artist",
  mentions: [{ userId: "2", label: "Artist" }],
  version: 3,
  createdAt: "2026-09-29T00:00:00Z",
  editedAt: null,
  deletedAt: null,
  replyTo: null,
  payload: {},
  attachments: [],
};
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const render = (value = item) =>
  act(async () =>
    root.render(
      <TaskCommentEdit
        item={value}
        crewId="crew"
        userId="1"
        generation={1}
        disabled={false}
        onSaved={h.saved}
        onRefresh={h.refresh}
      />
    )
  );
const type = (text: string) => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("captures the original version, preserves mentions and guards rapid save taps", async () => {
  let finish!: () => void;
  h.edit.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskActivity.editComment").click());
  await render({ ...item, version: 4, body: "Someone else changed it" });
  await act(async () => type("Changed @Artist"));
  await act(async () => {
    button("taskActivity.saveComment").click();
    button("taskActivity.saveComment").click();
  });
  expect(h.edit).toHaveBeenCalledExactlyOnceWith("task", "comment", {
    expectedVersion: 3,
    body: "Changed @Artist",
    mentions: item.mentions,
  });
  expect(host.querySelector("input")!.disabled).toBe(true);
  await act(async () => finish());
  expect(h.saved).toHaveBeenCalledTimes(1);
});
it("removes absent mentions and supports selecting new recipients", async () => {
  h.edit.mockResolvedValue({});
  await render();
  await act(async () => button("taskActivity.editComment").click());
  await act(async () => type("New text"));
  await act(async () => button("thread.mention").click());
  await act(async () => button("pick").click());
  await act(async () => button("taskActivity.saveComment").click());
  expect(h.edit).toHaveBeenCalledWith("task", "comment", {
    expectedVersion: 3,
    body: "New text @New ",
    mentions: [{ userId: "3", label: "New" }],
  });
});
it("retains the draft on conflict and requires refresh before another save", async () => {
  h.edit.mockRejectedValue(new Error("Version conflict"));
  await render();
  await act(async () => button("taskActivity.editComment").click());
  await act(async () => button("taskActivity.saveComment").click());
  expect(host.textContent).toContain("Version conflict");
  expect(button("taskActivity.saveComment").disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe(item.body);
  await act(async () => button("taskActivity.refreshComments").click());
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(h.saved).not.toHaveBeenCalled();
});
it("cancels without saving and ignores completions after account changes", async () => {
  await render();
  await act(async () => button("taskActivity.editComment").click());
  await act(async () => button("common.cancel").click());
  expect(h.edit).not.toHaveBeenCalled();
  let finish!: () => void;
  h.edit.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await act(async () => button("taskActivity.editComment").click());
  await act(async () => button("taskActivity.saveComment").click());
  h.generation = 2;
  await render();
  await act(async () => finish());
  expect(h.saved).not.toHaveBeenCalled();
});
