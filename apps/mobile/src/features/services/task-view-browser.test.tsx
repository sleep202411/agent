import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskViewBrowser } from "./task-view-browser";
import type { TaskOption } from "./task-options";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  views: vi.fn(),
  query: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
  more: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("./task-view-editor", () => ({
  TaskViewEditor: ({
    viewId,
    userId,
    onSaved,
    onClose,
  }: {
    viewId: string;
    userId: string;
    onSaved: () => void;
    onClose: () => void;
  }) => (
    <>
      <span>{`editing:${viewId}:${userId}`}</span>
      <button onClick={onSaved}>save editor</button>
      <button onClick={onClose}>close editor</button>
    </>
  ),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-view-api", () => ({ fetchTaskViews: h.views }));
vi.mock("./use-task-view-tasks", () => ({ useTaskViewTasks: h.query }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  FlatList: ({
    data,
    renderItem,
  }: {
    data: TaskOption[];
    renderItem: (value: { item: TaskOption }) => ReactNode;
  }) => (
    <>
      {data.map((item) => (
        <div key={item.id}>{renderItem({ item })}</div>
      ))}
    </>
  ),
}));

const views = [
  { id: "first", crewId: "crew", name: "Active", completedMode: "hidden", showSubIssues: false },
  { id: "second", crewId: "crew", name: "Archive", completedMode: "all", showSubIssues: true },
];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};
function Harness() {
  const [viewId, setViewId] = useState<string>();
  return (
    <TaskViewBrowser
      crewId="crew"
      userId="1"
      generation={1}
      viewId={viewId}
      onViewChange={setViewId}
      onSelect={h.select}
      onClose={h.close}
    />
  );
}
const render = async () => {
  await act(async () => root.render(<Harness />));
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.active = true;
  h.views.mockResolvedValue(views);
  h.query.mockReturnValue({
    items: [{ id: "task", number: 1, title: "Shot" }],
    loading: false,
    hasMore: true,
    loadMore: h.more,
    retry: h.retry,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("uses the first server view and displays saved visibility", async () => {
  await render();
  expect(h.query).toHaveBeenLastCalledWith("1", "crew", { viewId: "first", query: "" });
  expect(host.textContent).toContain("taskViews.hidden");
  expect(host.textContent).toContain("taskViews.topLevel");
});
it("switches views with server-side query scope", async () => {
  await render();
  await click("taskViews.view · Active");
  await click("Archive");
  expect(h.query).toHaveBeenLastCalledWith("1", "crew", { viewId: "second", query: "" });
  expect(host.textContent).toContain("taskViews.subtasks");
});
it("sends submitted search and priority", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "shot");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("crewAssets.search");
  await click("taskViews.priority · taskViews.anyPriority");
  await click("taskSchedule.urgent");
  expect(h.query).toHaveBeenLastCalledWith("1", "crew", {
    viewId: "first",
    query: "shot",
    priority: "urgent",
  });
  await click("discovery.more");
  expect(h.more).toHaveBeenCalledOnce();
});
it("selects once and ignores stale accounts", async () => {
  await render();
  await act(async () => {
    button("TASK-1 Shot").click();
    button("TASK-1 Shot").click();
  });
  expect(h.select).toHaveBeenCalledOnce();
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("");
});
it("hides on background and retries project reads", async () => {
  h.views.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(host.textContent).toContain("offline");
  await click("thread.refresh");
  expect(host.textContent).toContain("Active");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
it("clears task rows when refreshed project access fails", async () => {
  await render();
  h.views.mockRejectedValue(new Error("denied"));
  await click("thread.refresh");
  expect(host.textContent).toContain("denied");
  expect(host.textContent).not.toContain("Shot");
});

it("opens the selected view editor and refreshes project and rows after saving", async () => {
  await render();
  await click("viewEdit.title");
  expect(host.textContent).toContain("editing:first:1");
  const reads = h.views.mock.calls.length;
  await click("save editor");
  expect(h.views.mock.calls.length).toBe(reads + 1);
  expect(host.textContent).not.toContain("editing:");
  expect(h.query).toHaveBeenLastCalledWith(
    "1",
    "crew",
    expect.objectContaining({ viewId: "first" })
  );
});
