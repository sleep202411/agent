import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskManagementMenu } from "./task-management-menu";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ access: vi.fn(), generation: 1 }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let root: Root, host: HTMLDivElement;
const edit = vi.fn(),
  invite = vi.fn(),
  recruit = vi.fn();
beforeEach(() => {
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true, canInvite: true });
  host = document.createElement("div");
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(overrides: Partial<TaskDetail> = {}) {
  const task = {
    id: "task",
    crewId: "crew",
    status: "open",
    assignees: [],
    isRecruiting: false,
    ...overrides,
  } as TaskDetail;
  await act(async () =>
    root.render(
      <TaskManagementMenu
        task={task}
        userId="u"
        generation={1}
        edit={edit}
        invite={invite}
        recruit={recruit}
      />
    )
  );
}
async function click(label: string) {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
}
it("opens the requested management action and closes the menu", async () => {
  await render();
  await click("•••");
  expect(host.textContent).toContain("taskMenu.invite");
  expect(host.textContent).toContain("taskMenu.recruit");
  await click("taskMenu.edit");
  expect(edit).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("taskMenu.edit");
});
it("hides invitations without member-invite permission", async () => {
  h.access.mockResolvedValue({ canManage: true, canInvite: false });
  await render();
  await click("•••");
  expect(host.textContent).not.toContain("taskMenu.invite");
  expect(host.textContent).toContain("taskMenu.edit");
});
it("hides recruitment and invitations for assigned tasks", async () => {
  await render({ assignees: [{ id: "a", userId: "u" }] });
  await click("•••");
  expect(host.textContent).not.toContain("taskMenu.invite");
  expect(host.textContent).not.toContain("taskMenu.recruit");
});
it("does not offer management to a non-manager", async () => {
  h.access.mockResolvedValue({ canManage: false, canInvite: true });
  await render();
  expect(host.textContent).toBe("");
});
