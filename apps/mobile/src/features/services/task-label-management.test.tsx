import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskLabelManagement } from "./task-label-management";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-label-management-api", async (original) => ({
  ...(await original<typeof import("./task-label-management-api")>()),
  fetchManagedLabels: h.list,
  createTaskLabel: h.create,
  updateTaskLabel: h.update,
  deleteTaskLabel: h.remove,
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
const label = {
  id: "00000000-0000-4000-8000-000000000001",
  crewId: "crew",
  name: "Art",
  description: "Assets",
  color: "#aabbcc",
  updatedAt: "2026-09-30T00:00:00.000Z",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<TaskLabelManagement crewId="crew" userId="1" generation={1} onClose={h.close} />)
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
  h.list.mockResolvedValue([label]);
  h.create.mockResolvedValue(label);
  h.update.mockResolvedValue(label);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("keeps management unavailable when access fails and supports fresh retry", async () => {
  h.list.mockRejectedValue(new Error("Permission denied"));
  await render();
  expect(host.textContent).toContain("Permission denied");
  expect(button("taskLabels.add")).toBeUndefined();
  h.list.mockResolvedValue([]);
  await click("thread.refresh");
  expect(host.textContent).toContain("taskLabels.empty");
  expect(button("taskLabels.add")).toBeTruthy();
});
it("validates native creation and refreshes after saving", async () => {
  await render();
  await click("taskLabels.add");
  expect(button("taskLabels.save")?.disabled).toBe(true);
  await type(0, " Next ");
  await type(2, "red");
  expect(button("taskLabels.save")?.disabled).toBe(true);
  await type(2, "#ABCDEF");
  await type(1, " Work ");
  await click("taskLabels.save");
  expect(h.create).toHaveBeenCalledWith("crew", "1", 1, {
    name: "Next",
    description: "Work",
    color: "#abcdef",
  });
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("prefills editing, prevents no-op save and captures original version", async () => {
  await render();
  await click("ArtAssets");
  expect([...host.querySelectorAll("input")].map((n) => n.value)).toEqual([
    "Art",
    "Assets",
    "#aabbcc",
  ]);
  expect(button("taskLabels.save")?.disabled).toBe(true);
  await type(1, "Revised");
  await click("taskLabels.save");
  expect(h.update).toHaveBeenCalledWith(label, "1", 1, {
    name: "Art",
    description: "Revised",
    color: "#aabbcc",
  });
});
it("requires deletion confirmation and refreshes the list", async () => {
  await render();
  await click("ArtAssets");
  await click("taskLabels.delete");
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("taskLabels.deleteHelp");
  await click("taskLabels.confirmDelete");
  expect(h.remove).toHaveBeenCalledWith(label, "1", 1);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("editing a field resets deletion confirmation", async () => {
  await render();
  await click("ArtAssets");
  await click("taskLabels.delete");
  await type(0, "Next");
  expect(button("taskLabels.confirmDelete")).toBeUndefined();
  expect(h.remove).not.toHaveBeenCalled();
});
it("blocks duplicate submission and navigation during saving", async () => {
  h.create.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("taskLabels.add");
  await type(0, "Next");
  await act(async () => {
    button("taskLabels.save")!.click();
    button("taskLabels.save")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("locks failed writes until returning to a fresh list", async () => {
  h.update.mockRejectedValue(new Error("Label changed"));
  await render();
  await click("ArtAssets");
  await type(0, "Next");
  await click("taskLabels.save");
  expect(host.textContent).toContain("Label changed");
  expect(host.textContent).toContain("taskLabels.recheck");
  expect(button("taskLabels.save")?.disabled).toBe(true);
  expect(button("taskLabels.delete")?.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("aborts reads and ignores old account results", async () => {
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
  await act(async () => finish([label]));
  expect(button("taskLabels.add")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("does not refresh from a mutation completed under another account", async () => {
  let finish!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("taskLabels.add");
  await type(0, "Next");
  await click("taskLabels.save");
  h.generation = 2;
  await act(async () => finish(label));
  expect(h.list).toHaveBeenCalledOnce();
});
it("cancels without mutating and reloads the source list", async () => {
  await render();
  await click("ArtAssets");
  await type(0, "Next");
  await click("crewTasks.back");
  expect(h.update).not.toHaveBeenCalled();
  expect(h.list).toHaveBeenCalledTimes(2);
});
