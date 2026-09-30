import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskDelete } from "./task-delete";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  deleted: vi.fn(),
  generation: 1,
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-delete-api", () => ({ deleteTask: h.remove }));
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

const task = { id: "task", crewId: "crew", title: "Shot", version: 4 };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key);
const click = async (key: string) => {
  await act(async () => button(key)!.click());
};
const render = async (value = task) => {
  await act(async () =>
    root.render(
      <TaskDelete
        task={value}
        userId="manager"
        generation={1}
        onDeleted={h.deleted}
        onRefresh={h.refresh}
      />
    )
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires confirmation and explains child handling", async () => {
  await render();
  await click("taskDelete.title");
  expect(host.textContent).toContain("taskDelete.notice");
  expect(h.remove).not.toHaveBeenCalled();
  await click("taskDelete.confirm");
  expect(h.remove).toHaveBeenCalledWith(task, "manager", 1);
  expect(h.deleted).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("taskDelete.recheck");
});
it("allows cancelling without deletion", async () => {
  await render();
  await click("taskDelete.title");
  await click("common.cancel");
  expect(h.remove).not.toHaveBeenCalled();
});
it("hides deletion for non-managers", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(button("taskDelete.title")).toBeUndefined();
});
it("blocks stale displayed versions", async () => {
  await render();
  await click("taskDelete.title");
  await render({ ...task, version: 5 });
  expect(button("taskDelete.confirm")!.disabled).toBe(true);
  expect(h.remove).not.toHaveBeenCalled();
});
it("requires fresh review after uncertain deletion", async () => {
  h.remove.mockRejectedValue(new Error("offline"));
  await render();
  await click("taskDelete.title");
  await click("taskDelete.confirm");
  expect(h.deleted).not.toHaveBeenCalled();
  expect(button("taskDelete.confirm")).toBeUndefined();
  expect(host.textContent).toContain("taskDelete.recheck");
  await click("thread.refresh");
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("locks duplicate submissions and cancel during deletion", async () => {
  let resolve!: () => void;
  h.remove.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    })
  );
  await render();
  await click("taskDelete.title");
  await act(async () => {
    button("taskDelete.confirm")!.click();
    button("taskDelete.confirm")?.click();
  });
  expect(h.remove).toHaveBeenCalledOnce();
  expect(button("common.cancel")).toBeUndefined();
  await act(async () => resolve());
});
it("suppresses callbacks after account change", async () => {
  let resolve!: () => void;
  h.remove.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    })
  );
  await render();
  await click("taskDelete.title");
  await click("taskDelete.confirm");
  h.generation = 2;
  await act(async () => resolve());
  expect(h.deleted).not.toHaveBeenCalled();
});
it("blocks stale accounts before mutation", async () => {
  await render();
  await click("taskDelete.title");
  h.generation = 2;
  await click("taskDelete.confirm");
  expect(h.remove).not.toHaveBeenCalled();
});
