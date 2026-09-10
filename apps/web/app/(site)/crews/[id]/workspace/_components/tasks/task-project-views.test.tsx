import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TaskProjectView, type TaskProjectViewProps } from "./task-project-views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span role="img" aria-label={name} />,
}));
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
});
it.each(["list", "board"])("shows every assignee name alongside avatars in %s", async (layout) => {
  const props = {
    tasks: [
      {
        id: "task",
        number: 1,
        title: "Example task",
        createdAt: "2026-09-10T00:00:00Z",
        workflowStateId: "todo",
        priority: "normal",
        labels: [],
        assignees: [{ userId: "one" }, { userId: "two" }],
        fieldValues: [],
        subTaskCount: 0,
      },
    ],
    view: {
      layout,
      filters: {},
      visibleFields: ["assignees"],
      groupBy: null,
      showEmptyGroups: true,
    },
    workflowStates: [
      {
        id: "todo",
        name: "Todo",
        color: "#ffffff",
        semantic: "todo",
        position: 0,
        archived: false,
      },
    ],
    cycles: [],
    fields: [],
    displays: new Map([
      ["one", { name: "Alice", nickname: "Alice" }],
      ["two", { name: "Bob", nickname: "Bob" }],
    ]),
    selectedIds: new Set(),
    canManage: false,
    onToggleSelected: vi.fn(),
    onToggleAll: vi.fn(),
    onOpenTask: vi.fn(),
    onQuickUpdate: vi.fn(),
    onMoveTask: vi.fn(),
    onCreateWorkflowState: vi.fn(),
    onEditWorkflowState: vi.fn(),
    onCreateTask: vi.fn(),
  } as unknown as TaskProjectViewProps;
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<TaskProjectView {...props} />));
  for (const name of ["Alice", "Bob"]) {
    expect(el.textContent).toContain(name);
    expect(el.querySelector(`[role="img"][aria-label="${name}"]`)).not.toBeNull();
  }
});
