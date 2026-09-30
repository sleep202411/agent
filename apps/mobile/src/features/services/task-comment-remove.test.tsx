import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCommentRemove } from "./task-comment-remove";
const h = vi.hoisted(() => ({
  remove: vi.fn(),
  removed: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
  active: true,
}));
vi.mock("./task-comment-api", () => ({ removeTaskComment: h.remove }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const render = () =>
  act(async () =>
    root.render(
      <TaskCommentRemove
        commentId="comment"
        generation={1}
        disabled={false}
        onRemoved={h.removed}
        onRefresh={h.refresh}
      />
    )
  );
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
it("requires confirmation and guards duplicate taps while deletion is pending", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskActivity.deleteComment").click());
  expect(h.remove).not.toHaveBeenCalled();
  await act(async () => button("common.cancel").click());
  expect(h.remove).not.toHaveBeenCalled();
  await act(async () => button("taskActivity.deleteComment").click());
  await act(async () => {
    button("taskActivity.confirmDeleteAction").click();
    button("taskActivity.confirmDeleteAction").click();
  });
  expect(h.remove).toHaveBeenCalledExactlyOnceWith("comment");
  expect(button("common.cancel").disabled).toBe(true);
  await act(async () => finish());
  expect(h.removed).toHaveBeenCalledTimes(1);
});
it("keeps errors visible and offers history refresh without claiming success", async () => {
  h.remove.mockRejectedValue(new Error("Task comment not found"));
  await render();
  await act(async () => button("taskActivity.deleteComment").click());
  await act(async () => button("taskActivity.confirmDeleteAction").click());
  expect(host.textContent).toContain("Task comment not found");
  expect(h.removed).not.toHaveBeenCalled();
  await act(async () => button("taskActivity.refreshComments").click());
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("suppresses completion after an account change or screen departure", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskActivity.deleteComment").click());
  await act(async () => button("taskActivity.confirmDeleteAction").click());
  h.generation = 2;
  await render();
  await act(async () => finish());
  expect(h.removed).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
