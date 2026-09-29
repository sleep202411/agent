import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskViewLifecycle } from "./task-view-lifecycle";
const h = vi.hoisted(() => ({
  generation: 1,
  context: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-view-lifecycle-api", async (original) => ({
  ...(await original<typeof import("./task-view-lifecycle-api")>()),
  fetchViewLifecycleContext: h.context,
  createTaskView: h.create,
  deleteTaskView: h.remove,
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
}));
const view = { id: "view", name: "Source", isSystem: false };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = (action: "create" | "remove" = "create") =>
  act(async () =>
    root.render(
      <TaskViewLifecycle
        crewId="crew"
        userId="1"
        generation={1}
        viewId="view"
        action={action}
        onClose={h.close}
        onChanged={h.changed}
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
  h.context.mockResolvedValue({ view, fallbackId: "fallback", viewIds: ["view", "fallback"] });
  h.create.mockResolvedValue({ id: "new" });
  h.remove.mockResolvedValue("fallback");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires an authorized context before showing controls", async () => {
  h.context.mockRejectedValue(new Error("Permission denied"));
  await render();
  expect(host.textContent).toContain("Permission denied");
  expect(host.querySelector("input")).toBeNull();
});
it("requires a name, selects layout and navigates to the newly created view", async () => {
  await render();
  expect(button("viewLifecycle.create")?.disabled).toBe(true);
  await type(" New ");
  await click("viewEdit.board");
  expect(h.create).not.toHaveBeenCalled();
  await click("viewLifecycle.create");
  expect(h.create).toHaveBeenCalledWith(view, { name: "New", layout: "board" }, "1", 1);
  expect(h.changed).toHaveBeenCalledExactlyOnceWith("new");
});
it("requires separate delete confirmation and returns the fallback view", async () => {
  await render("remove");
  expect(host.textContent).toContain("Source");
  await click("viewLifecycle.remove");
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("viewLifecycle.confirmHelp");
  await click("viewLifecycle.confirmRemove");
  expect(h.remove).toHaveBeenCalledWith(view, "1", 1);
  expect(h.changed).toHaveBeenCalledExactlyOnceWith("fallback");
});
it.each(["system", "last"])("disables %s view deletion", async (mode) => {
  h.context.mockResolvedValue({
    view: { ...view, isSystem: mode === "system" },
    fallbackId: mode === "last" ? undefined : "fallback",
  });
  await render("remove");
  expect(button("viewLifecycle.remove")?.disabled).toBe(true);
  expect(host.textContent).toContain(`viewLifecycle.${mode}`);
});
it("suppresses rapid duplicate creation taps and locks navigation while pending", async () => {
  h.create.mockImplementation(() => new Promise(() => {}));
  await render();
  await type("Next");
  await act(async () => {
    button("viewLifecycle.create")!.click();
    button("viewLifecycle.create")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it.each(["create", "remove"] as const)(
  "locks uncertain %s until returning to the list",
  async (action) => {
    h.create.mockRejectedValue(new Error("Connection lost"));
    h.remove.mockRejectedValue(new Error("Connection lost"));
    await render(action);
    if (action === "create") {
      await type("Next");
      await click("viewLifecycle.create");
    } else {
      await click("viewLifecycle.remove");
      await click("viewLifecycle.confirmRemove");
    }
    expect(host.textContent).toContain("viewLifecycle.recheck");
    expect(h.changed).not.toHaveBeenCalled();
    expect(
      button(action === "create" ? "viewLifecycle.create" : "viewLifecycle.confirmRemove")?.disabled
    ).toBe(true);
    await click("crewTasks.back");
    expect(h.close).toHaveBeenCalledOnce();
  }
);
it("ignores context after account change and aborts on unmount", async () => {
  let finish!: (v: unknown) => void;
  h.context.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.context.mock.calls[0]?.[4] as AbortSignal;
  h.generation = 2;
  await act(async () => finish({ view }));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("ignores completion after account changes", async () => {
  let finish!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await type("Next");
  await click("viewLifecycle.create");
  h.generation = 2;
  await act(async () => finish({ id: "new" }));
  expect(h.changed).not.toHaveBeenCalled();
});
it("cancel does not create or delete", async () => {
  await render("remove");
  await click("viewLifecycle.remove");
  await click("crewTasks.back");
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  expect(h.close).toHaveBeenCalledOnce();
});
