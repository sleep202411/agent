import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TaskCustomFieldEditing } from "./task-custom-field-editor";
import type { TaskDetail } from "./task-detail-api";
import type { CustomField } from "./task-custom-fields-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-custom-fields-api", async (original) => ({
  ...(await original<typeof import("./task-custom-fields-api")>()),
  fetchTaskCustomFields: h.fetch,
}));
vi.mock("./task-custom-field-edit-api", async (original) => ({
  ...(await original<typeof import("./task-custom-field-edit-api")>()),
  updateCustomField: h.update,
}));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({ onSelect }: { onSelect: (m: { userId: string }) => void }) => (
    <button onClick={() => onSelect({ userId: "42" })}>Pick Artist</button>
  ),
}));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["42", { nickname: "Artist" }]]),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const task: TaskDetail = {
  id: "task",
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Brief",
  version: 4,
  status: "open",
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [],
  submissions: [],
};
const field: CustomField = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  name: "Field",
  type: "text",
  required: false,
  options: [],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.fetch.mockResolvedValue([{ field, value: "Before" }]);
  h.update.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = (value = task) =>
  act(async () =>
    root.render(
      <TaskCustomFieldEditing
        task={value}
        userId="1"
        generation={1}
        fields={[field]}
        onRefresh={h.refresh}
      />
    )
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const open = async () => {
  await render();
  await act(async () => button("taskCustomFields.edit · Field").click());
};
const type = (value: string) => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
it("uses fresh field data and suppresses rapid duplicate saves", async () => {
  h.update.mockReturnValue(new Promise(() => {}));
  await open();
  expect(host.querySelector("input")!.value).toBe("Before");
  await act(async () => type("After"));
  await act(async () => {
    button("taskPlanning.save").click();
    button("taskPlanning.save").click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(task, field, "After");
  expect(button("myServices.cancel").disabled).toBe(true);
});
it("hides editing for viewers and closed tasks", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(host.querySelector("button")).toBeNull();
  await render({ ...task, status: "approved" });
  expect(host.querySelector("button")).toBeNull();
});
it("freezes an uncertain failure until task refresh", async () => {
  h.update.mockRejectedValue(new Error("Offline"));
  await open();
  await act(async () => type("After"));
  await act(async () => button("taskPlanning.save").click());
  expect(host.textContent).toContain("Offline");
  expect(button("taskPlanning.save").disabled).toBe(true);
  await act(async () => button("myServices.cancel").click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("rejects required empty input and stale account clicks", async () => {
  h.fetch.mockResolvedValue([{ field: { ...field, required: true }, value: "Before" }]);
  await open();
  await act(async () => type(""));
  expect(button("taskPlanning.save").disabled).toBe(true);
  expect(button("taskCustomFields.clear")).toBeUndefined();
  await act(async () => type("After"));
  h.generation = 2;
  await act(async () => button("taskPlanning.save").click());
  expect(h.update).not.toHaveBeenCalled();
});
it("selects active Crew members using the existing picker", async () => {
  h.fetch.mockResolvedValue([{ field: { ...field, type: "user" }, value: null }]);
  await open();
  await act(async () => button("taskCustomFields.chooseMember").click());
  await act(async () => button("Pick Artist").click());
  expect(host.textContent).toContain("Artist");
  await act(async () => button("taskPlanning.save").click());
  expect(h.update).toHaveBeenCalledWith(task, expect.objectContaining({ type: "user" }), "42");
});

it.each(["single_select", "multi_select", "checkbox"] as const)(
  "saves %s choices with their typed values",
  async (type) => {
    const definition = { ...field, type, options: [{ id: "art", label: "Art" }] };
    h.fetch.mockResolvedValue([{ field: definition, value: null }]);
    await open();
    await act(async () => button(type === "checkbox" ? "taskCustomFields.no" : "Art").click());
    await act(async () => button("taskPlanning.save").click());
    expect(h.update).toHaveBeenCalledWith(
      task,
      definition,
      type === "checkbox" ? false : type === "multi_select" ? ["art"] : "art"
    );
  }
);
it("suppresses a late save completion after account replacement", async () => {
  let finish!: (v: unknown) => void;
  h.update.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await open();
  await act(async () => type("After"));
  await act(async () => button("taskPlanning.save").click());
  h.generation = 2;
  await act(async () => finish({}));
  expect(h.refresh).not.toHaveBeenCalled();
});
it("keeps stale or deleted field loads out of the editor", async () => {
  h.fetch.mockResolvedValue([]);
  await open();
  expect(host.textContent).toContain("no longer exists");
  expect(host.querySelector("input")).toBeNull();
  expect(h.update).not.toHaveBeenCalled();
});
