import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskViewEditor } from "./task-view-editor";
import { editableView } from "./task-view-edit-api";
const h = vi.hoisted(() => ({
  generation: 1,
  access: vi.fn(),
  project: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  saved: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-view-edit-api", async (original) => ({
  ...(await original<typeof import("./task-view-edit-api")>()),
  fetchViewEditProject: h.project,
  saveTaskView: h.save,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({
    onSelect,
  }: {
    onSelect: (v: { userId: string; label: string }) => void;
  }) => <button onClick={() => onSelect({ userId: "2", label: "Artist" })}>pick member</button>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = () =>
  editableView.parse({
    id: uid(1),
    crewId: "crew",
    name: "All",
    layout: "board",
    groupBy: "status",
    filters: { cycleIds: [uid(9)] },
    sorts: [],
    visibleFields: [`custom:${uid(8)}`],
    completedMode: "all",
    showSubIssues: true,
    showEmptyGroups: false,
    updatedAt: "2026-09-30T00:00:00.000Z",
    isSystem: true,
  });
const project = () => ({
  views: [view()],
  cycles: [{ id: uid(2), crewId: "crew", name: "Sprint" }],
  workflowStates: [],
  labels: [],
  fields: [],
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <TaskViewEditor
        crewId="crew"
        userId="1"
        generation={1}
        viewId={uid(1)}
        onSaved={h.saved}
        onClose={h.close}
      />
    )
  );
const type = (value: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.project.mockResolvedValue(project());
  h.save.mockResolvedValue(view());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads scoped project only for managers and reports missing views", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(host.textContent).toContain("taskCreate.managerOnly");
  expect(h.project).not.toHaveBeenCalled();
  h.access.mockResolvedValue({ canManage: true });
  h.project.mockResolvedValue({ ...project(), views: [] });
  await click("thread.refresh");
  expect(host.textContent).toContain("viewEdit.missing");
  expect(host.querySelector("input")).toBeNull();
});
it("requires an actual valid edit and preserves unrelated settings", async () => {
  await render();
  expect(button("viewEdit.save")?.disabled).toBe(true);
  await type(" ");
  expect(button("viewEdit.save")?.disabled).toBe(true);
  await type("Next");
  await click("viewEdit.save");
  expect(h.save).toHaveBeenCalledWith(
    view(),
    expect.objectContaining({
      name: "Next",
      filters: view().filters,
      visibleFields: view().visibleFields,
      layout: "board",
    }),
    "1",
    1
  );
  expect(h.saved).toHaveBeenCalledTimes(1);
});
it("allows removing unavailable references and clears filters explicitly", async () => {
  await render();
  await click("viewEdit.field.cycle · 1");
  await click(`✓ ${uid(9)}`);
  await click("○ Sprint");
  await click("viewEdit.fields · 1");
  await click(`✓ custom:${uid(8)}`);
  await click("viewEdit.clearFilters");
  await click("viewEdit.save");
  expect(h.save.mock.calls[0]?.[1]).toMatchObject({ filters: {}, visibleFields: [] });
});
it("supports member filters and ordered sorting", async () => {
  await render();
  await click("viewEdit.addMember");
  await click("pick member");
  await click("viewEdit.addSort");
  await click("viewEdit.sorts 1 · viewEdit.field.rank");
  await click("viewEdit.field.dueAt");
  await click("viewEdit.direction · viewEdit.asc");
  await click("viewEdit.desc");
  await click("viewEdit.addSort");
  await click("viewEdit.moveUp");
  await click("viewEdit.save");
  expect(h.save.mock.calls[0]?.[1]).toMatchObject({
    filters: { assigneeUserIds: ["2"] },
    sorts: [
      { field: "rank", direction: "asc" },
      { field: "dueAt", direction: "desc" },
    ],
  });
});
it("saves only on explicit action and suppresses duplicate taps", async () => {
  h.save.mockImplementation(() => new Promise(() => {}));
  await render();
  await type("Next");
  expect(h.save).not.toHaveBeenCalled();
  await act(async () => {
    button("viewEdit.save")!.click();
    button("viewEdit.save")!.click();
  });
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("locks uncertain writes until a fresh project is loaded", async () => {
  h.save.mockRejectedValue(new Error("Connection lost"));
  await render();
  await type("Next");
  await click("viewEdit.save");
  expect(host.textContent).toContain("Connection lost");
  expect(button("viewEdit.save")?.disabled).toBe(true);
  expect(h.saved).not.toHaveBeenCalled();
  await click("thread.refresh");
  expect(h.project).toHaveBeenCalledTimes(2);
  expect(host.querySelector("input")?.value).toBe("All");
  expect(button("viewEdit.save")?.disabled).toBe(true);
});
it("ignores a project read returned after account change and aborts on unmount", async () => {
  let finish!: (v: unknown) => void;
  h.project.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.project.mock.calls[0]?.[1] as AbortSignal;
  h.generation = 2;
  await act(async () => finish(project()));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("does not report a save after the account changed", async () => {
  let finish!: (v: unknown) => void;
  h.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await type("Next");
  await click("viewEdit.save");
  h.generation = 2;
  await act(async () => finish(view()));
  expect(h.saved).not.toHaveBeenCalled();
});
it("cancel does not mutate", async () => {
  await render();
  await type("Next");
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.save).not.toHaveBeenCalled();
});

it("edits completion, subtasks and Web display while limiting sort rules", async () => {
  await render();
  await click("viewEdit.completed · taskViews.all");
  await click("taskViews.hidden");
  await click("✓ taskViews.subtasks");
  await click("viewEdit.layout · viewEdit.board");
  await click("viewEdit.list");
  await click("viewEdit.group · viewEdit.group.status");
  await click("viewEdit.group.none");
  await click("○ viewEdit.emptyGroups");
  await click("viewEdit.addSort");
  await click("viewEdit.addSort");
  await click("viewEdit.addSort");
  expect(button("viewEdit.addSort")?.disabled).toBe(true);
  await click("viewEdit.save");
  expect(h.save.mock.calls[0]?.[1]).toMatchObject({
    completedMode: "hidden",
    showSubIssues: false,
    layout: "list",
    groupBy: "none",
    showEmptyGroups: true,
  });
});
