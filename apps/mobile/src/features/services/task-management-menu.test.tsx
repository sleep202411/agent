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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true, canInvite: true });
  host = document.createElement("div");
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(overrides: Partial<TaskDetail> = {}, credit?: () => void) {
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
        credit={credit}
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

it("allows credit only for the assigned creator without granting management", async () => {
  h.access.mockResolvedValue({ canManage: false, canInvite: false });
  const credit = vi.fn();
  await render({ assignees: [{ id: "a", userId: "u" }] }, credit);
  await click("•••");
  expect(host.textContent).toContain("taskMenu.addCredit");
  expect(host.textContent).not.toContain("taskMenu.edit");
  await click("taskMenu.addCredit");
  expect(credit).toHaveBeenCalledOnce();
  await render({ assignees: [] }, credit);
  expect(host.textContent).toBe("");
});

it("does not let an unassigned manager request another creator's points", async () => {
  await render({}, vi.fn());
  await click("•••");
  expect(host.textContent).toContain("taskMenu.edit");
  expect(host.textContent).not.toContain("taskMenu.addCredit");
});
