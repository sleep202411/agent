import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TaskFieldManagement } from "./task-field-management";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
  generation: 1,
  t: (s: string) => s,
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "22222222-2222-4222-8222-222222222222" },
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-field-management-api", async (original) => ({
  ...(await original<typeof import("./task-field-management-api")>()),
  fetchManagedFields: h.fetch,
  createFieldDefinition: h.create,
  updateFieldDefinition: h.update,
  deleteFieldDefinition: h.remove,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
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
const field = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  name: "Department",
  description: "Brief",
  type: "text",
  required: false,
  options: [],
  updatedAt: "2026-09-29T00:00:00.000Z",
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.fetch.mockResolvedValue([field]);
  h.create.mockResolvedValue(field);
  h.update.mockResolvedValue(field);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () =>
  act(async () =>
    root.render(<TaskFieldManagement crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
const button = (s: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === s)!;
const type = (n: number, value: string) => {
  const el = host.querySelectorAll("input")[n]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
it("does not read settings for a non-manager", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain("taskCreate.managerOnly");
  expect(button("taskFields.add")).toBeUndefined();
});
it("creates definitions using typed options and blocks duplicate saves", async () => {
  h.create.mockReturnValue(new Promise(() => {}));
  await render();
  await act(async () => button("taskFields.add").click());
  await act(async () => {
    type(0, "New");
    button("taskFields.single_select").click();
  });
  await act(async () => type(2, "Art,Art"));
  await act(async () => {
    button("taskPlanning.save").click();
    button("taskPlanning.save").click();
  });
  expect(h.create).toHaveBeenCalledExactlyOnceWith(
    "crew",
    expect.objectContaining({
      name: "New",
      type: "single_select",
      options: [{ id: "22222222-2222-4222-8222-222222222222", label: "Art" }],
    })
  );
});
it("edits against the fetched timestamp and preserves field type", async () => {
  await render();
  await act(async () => button("Department · taskFields.text").click());
  await act(async () => type(0, "Renamed"));
  await act(async () => button("taskPlanning.save").click());
  expect(h.update).toHaveBeenCalledWith(
    field,
    expect.objectContaining({ name: "Renamed", expectedUpdatedAt: field.updatedAt })
  );
  expect(h.fetch).toHaveBeenCalledTimes(2);
});
it("requires two steps before deletion and blocks repeated destructive writes", async () => {
  h.remove.mockReturnValue(new Promise(() => {}));
  await render();
  await act(async () => button("Department · taskFields.text").click());
  await act(async () => button("taskFields.delete").click());
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("taskFields.deleteWarning");
  await act(async () => {
    button("taskFields.confirmDelete").click();
    button("taskFields.confirmDelete").click();
  });
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(field);
});
it("locks an uncertain write and refreshes before allowing another", async () => {
  h.update.mockRejectedValue(new Error("Offline"));
  await render();
  await act(async () => button("Department · taskFields.text").click());
  await act(async () => button("taskPlanning.save").click());
  expect(host.textContent).toContain("Offline");
  expect(button("taskPlanning.save").disabled).toBe(true);
  await act(async () => button("myServices.cancel").click());
  expect(h.fetch).toHaveBeenCalledTimes(2);
});
it("ignores late permission results after an account change", async () => {
  let finish!: (v: unknown) => void;
  h.access.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  h.generation = 2;
  await act(async () => finish({ canManage: true }));
  expect(button("taskFields.add")).toBeUndefined();
});
