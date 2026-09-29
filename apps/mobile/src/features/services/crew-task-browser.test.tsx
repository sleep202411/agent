import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewTaskBrowser } from "./crew-task-browser";
const h = vi.hoisted(() => ({ generation: 1, close: vi.fn(), detail: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <span>{path}</span>,
}));
vi.mock("./task-create", () => ({
  TaskCreate: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated("new")}>create form</button>
  ),
}));
vi.mock("./task-picker", () => ({
  TaskPicker: ({
    onSelect,
    onClose,
  }: {
    onSelect: (task: { id: string }) => void;
    onClose: () => void;
  }) => (
    <>
      <button onClick={() => onSelect({ id: "task" })}>pick</button>
      <button onClick={onClose}>close</button>
    </>
  ),
}));
vi.mock("./task-detail", () => ({
  TaskDetail: (props: {
    onClose: () => void;
    onOpenWeb: (id: string) => void;
    closeLabel: string;
    taskId: string;
  }) => {
    h.detail(props);
    return (
      <>
        <span>{props.taskId}</span>
        <button onClick={props.onClose}>{props.closeLabel}</button>
        <button onClick={() => props.onOpenWeb("related")}>web</button>
      </>
    );
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(async () => {
  vi.clearAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(<CrewTaskBrowser crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("opens authorized native detail and returns to the task list", async () => {
  await act(async () => button("pick").click());
  expect(h.detail).toHaveBeenLastCalledWith(
    expect.objectContaining({ crewId: "crew", taskId: "task", userId: "1", generation: 1 })
  );
  await act(async () => button("crewTasks.back").click());
  expect(button("pick")).toBeTruthy();
  await act(async () => button("close").click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("continues the currently viewed related task on Web and returns to it", async () => {
  await act(async () => button("pick").click());
  await act(async () => button("web").click());
  expect(host.textContent).toContain("/crews/crew/workspace?tab=tasks&task=related");
  await act(async () => button("taskRelations.backToTask").click());
  expect(h.detail).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "related" }));
});
it("ignores stale task selection after account changes", async () => {
  h.generation = 2;
  await act(async () => button("pick").click());
  expect(h.detail).not.toHaveBeenCalled();
});

it("opens the newly created task directly", async () => {
  await act(async () => button("taskCreate.title").click());
  await act(async () => button("create form").click());
  expect(h.detail).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "new" }));
});
