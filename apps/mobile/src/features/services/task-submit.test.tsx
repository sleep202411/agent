import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskSubmit } from "./task-submit";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  permission: vi.fn(),
  submit: vi.fn(),
  template: vi.fn(),
  folders: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-submit-api", async (original) => ({
  ...(await original<typeof import("./task-submit-api")>()),
  fetchTaskSubmitPermission: h.permission,
  submitTask: h.submit,
  fetchDeliveryFolders: h.folders,
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
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
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
vi.mock("./task-delivery-api", async (original) => ({
  ...(await original<typeof import("./task-delivery-api")>()),
  fetchTaskDeliveryTemplate: h.template,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({
  CrewAssetPicker: ({ onSelect }: { onSelect: (assets: unknown[]) => void }) => (
    <button
      onClick={() => onSelect([{ id: "22222222-2222-4222-8222-222222222222", name: "Final.mp4" }])}
    >
      pick file
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const id = "11111111-1111-4111-8111-111111111111";
const task: TaskDetail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "",
  version: 1,
  status: "open",
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [{ id, userId: "1" }],
  submissions: [],
};
let root: Root, host: HTMLDivElement;
const render = (value = task) =>
  act(async () =>
    root.render(<TaskSubmit task={value} userId="1" generation={1} onRefresh={h.refresh} />)
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
const type = (n: number, text: string) => {
  const input = host.querySelectorAll("input")[n]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.permission.mockResolvedValue(true);
  h.template.mockResolvedValue(null);
  h.folders.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("hides submission without permission or outside accepting states", async () => {
  h.permission.mockResolvedValue(false);
  await render();
  expect(host.textContent).toBe("");
  expect(h.template).not.toHaveBeenCalled();
  await render({ ...task, status: "approved" });
  expect(host.textContent).toBe("");
});
it("keeps template failures blocking rather than treating them as no requirements", async () => {
  h.template.mockRejectedValue(new Error("Requirements unavailable"));
  await render();
  expect(host.textContent).toContain("Requirements unavailable");
  expect(button("taskSubmit.submitAction")).toBeUndefined();
});
it("enforces required text and file fields, and prunes removed file answers", async () => {
  h.template.mockResolvedValue({
    categoryId: id,
    version: 2,
    definition: {
      name: "Delivery",
      description: "",
      prices: [],
      fields: [
        { key: "brief", label: "Brief", type: "text", required: true, instructions: "" },
        { key: "video", label: "Video", type: "attachment", required: true, instructions: "" },
      ],
    },
  });
  await render();
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => type(1, "Final"));
  await act(async () => button("crewAssets.choose · 0/100")!.click());
  await act(async () => button("pick file")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => button("○ Final.mp4")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(false);
  await act(async () => button("Final.mp4 ×")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
});
it("submits once, freezes an uncertain result and requires refresh", async () => {
  h.submit.mockRejectedValue(new Error("Connection lost"));
  await render();
  await act(async () => {
    button("taskSubmit.submitAction")!.click();
    button("taskSubmit.submitAction")!.click();
  });
  expect(h.submit).toHaveBeenCalledExactlyOnceWith(task, "1", { note: "", assetNodeIds: [] }, null);
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  expect(host.textContent).toContain("Connection lost");
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("includes a chosen delivery folder and refreshes after success", async () => {
  h.folders.mockResolvedValue([
    { id, parentId: null, name: "Deliveries", effectivePermission: "upload" },
  ]);
  h.submit.mockResolvedValue({});
  await render();
  await act(async () =>
    button("taskSubmit.deliveryFolder: taskSubmit.automaticDeliveryFolder")!.click()
  );
  await act(async () => button("Deliveries")!.click());
  await act(async () => button("taskSubmit.submitAction")!.click());
  expect(h.submit).toHaveBeenCalledExactlyOnceWith(
    task,
    "1",
    { note: "", assetNodeIds: [], deliveryFolderId: id },
    null
  );
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("aborts prerequisite reads and ignores late account results", async () => {
  let finish!: (v: boolean) => void;
  h.permission.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.permission.mock.calls[0][2];
  h.generation = 2;
  await act(async () => finish(true));
  expect(button("taskSubmit.submitAction")).toBeUndefined();
  expect(h.template).not.toHaveBeenCalled();
  expect(h.folders).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("ignores successful submission callbacks after an account change", async () => {
  let finish!: () => void;
  h.submit.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => button("taskSubmit.submitAction")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});

it("shows unresolved blockers and prevents submission until refreshed dependencies are resolved", async () => {
  const dependency = {
    id,
    number: 2,
    title: "Render",
    status: "in_progress",
    workflowState: { name: "In progress" },
    parentId: null,
    resolved: false,
  };
  await render({ ...task, blockedBy: [dependency] });
  expect(host.textContent).toContain("taskRelations.blockedSubmitHint");
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => button("taskSubmit.submitAction")!.click());
  expect(h.submit).not.toHaveBeenCalled();
  await render({
    ...task,
    version: 2,
    blockedBy: [{ ...dependency, status: "approved", resolved: true }],
  });
  expect(button("taskSubmit.submitAction")!.disabled).toBe(false);
});
