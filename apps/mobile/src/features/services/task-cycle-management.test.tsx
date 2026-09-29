import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCycleManagement } from "./task-cycle-management";
import { cycleDateText } from "./task-cycle-management-api";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-cycle-management-api", async (original) => ({
  ...(await original<typeof import("./task-cycle-management-api")>()),
  fetchManagedCycles: h.list,
  createTaskCycle: h.create,
  updateTaskCycle: h.update,
  deleteTaskCycle: h.remove,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const cycle = {
  id: "00000000-0000-4000-8000-000000000001",
  crewId: "crew",
  number: 1,
  name: "Sprint",
  goal: "Shots",
  status: "planned",
  startAt: "2026-10-01T08:12:15.123Z",
  endAt: "2026-10-05T09:13:16.456Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const open = () => click("C1 · Sprint · taskCycles.plannedShots");
const render = () =>
  act(async () =>
    root.render(<TaskCycleManagement crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
const type = (index: number, value: string) =>
  act(async () => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.list.mockResolvedValue([cycle]);
  h.create.mockResolvedValue(cycle);
  h.update.mockResolvedValue(cycle);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires permission and supports fresh list retry", async () => {
  h.list.mockRejectedValue(new Error("Permission denied"));
  await render();
  expect(host.textContent).toContain("Permission denied");
  expect(button("taskCycles.add")).toBeUndefined();
  h.list.mockResolvedValue([]);
  await click("thread.refresh");
  expect(host.textContent).toContain("taskCycles.empty");
});
it("requires valid calendar dates and creates a planned cycle", async () => {
  await render();
  await click("taskCycles.add");
  await type(0, "Next");
  await type(2, "2026-02-30");
  await type(3, "2026-03-01");
  expect(button("taskCycles.save")?.disabled).toBe(true);
  await type(2, "2026-03-02");
  expect(button("taskCycles.save")?.disabled).toBe(true);
  await type(2, "2026-03-01");
  expect(button("taskCycles.save")?.disabled).toBe(false);
  await click("taskCycles.save");
  const payload = h.create.mock.calls[0]?.[3];
  expect(payload.name).toBe("Next");
  expect(payload.status).toBeUndefined();
  expect(cycleDateText(payload.startAt)).toBe("2026-03-01");
  expect(cycleDateText(payload.endAt)).toBe("2026-03-01");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("prefills dates and preserves full timestamps on a name edit", async () => {
  await render();
  await open();
  expect(button("taskCycles.save")?.disabled).toBe(true);
  expect([...host.querySelectorAll("input")].map((n) => n.value)).toEqual([
    "Sprint",
    "Shots",
    cycleDateText(cycle.startAt),
    cycleDateText(cycle.endAt),
  ]);
  await type(0, "Renamed");
  await click("taskCycles.save");
  expect(h.update).toHaveBeenCalledWith(cycle, "1", 1, {
    name: "Renamed",
    goal: cycle.goal,
    status: "planned",
    startAt: cycle.startAt,
    endAt: cycle.endAt,
  });
});
it("submits status changes and displays active-cycle conflicts without retry", async () => {
  h.update.mockRejectedValue(new Error('Complete active cycle "Other" first.'));
  await render();
  await open();
  await click("taskCycles.active");
  await click("taskCycles.save");
  expect(h.update.mock.calls[0]?.[3].status).toBe("active");
  expect(host.textContent).toContain('Complete active cycle "Other" first.');
  expect(button("taskCycles.save")?.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("confirms deletion without deleting task records locally", async () => {
  await render();
  await open();
  await click("taskCycles.delete");
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("taskCycles.deleteHelp");
  await click("taskCycles.confirmDelete");
  expect(h.remove).toHaveBeenCalledWith(cycle, "1", 1);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("changes to dates reset deletion confirmation", async () => {
  await render();
  await open();
  await click("taskCycles.delete");
  await type(2, "2026-10-02");
  expect(button("taskCycles.confirmDelete")).toBeUndefined();
});
it("suppresses duplicate saves and prevents navigation while pending", async () => {
  h.update.mockImplementation(() => new Promise(() => {}));
  await render();
  await open();
  await type(0, "Next");
  await act(async () => {
    button("taskCycles.save")!.click();
    button("taskCycles.save")!.click();
  });
  expect(h.update).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("ignores account changes during reads and aborts on unmount", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.list.mock.calls[0]?.[3] as AbortSignal;
  h.generation = 2;
  await act(async () => finish([cycle]));
  expect(button("taskCycles.add")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("ignores a write completed after account change", async () => {
  let finish!: (v: unknown) => void;
  h.update.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await open();
  await type(0, "Next");
  await click("taskCycles.save");
  h.generation = 2;
  await act(async () => finish(cycle));
  expect(h.list).toHaveBeenCalledOnce();
});
it("cancel returns to a fresh list without writing", async () => {
  await render();
  await open();
  await type(0, "Next");
  await click("crewTasks.back");
  expect(h.update).not.toHaveBeenCalled();
  expect(h.list).toHaveBeenCalledTimes(2);
});
