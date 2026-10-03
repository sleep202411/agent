import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskSubmit } from "./task-submit";
import { useTaskSubmitSession } from "./use-task-submit-session";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  permission: vi.fn(),
  submit: vi.fn(),
  template: vi.fn(),
  folders: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
  uploadProps: vi.fn(),
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
vi.mock("@/features/crew-assets/file-upload", () => ({
  AssetFileUpload: (props: {
    onAttached: (asset: { id: string; name: string }) => void;
    onClose: () => void;
  }) => {
    h.uploadProps(props);
    return (
      <button
        onClick={() => {
          props.onAttached({ id: "22222222-2222-4222-8222-222222222222", name: "Uploaded.mp4" });
          props.onClose();
        }}
      >
        finish upload
      </button>
    );
  },
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

it("uploads into the selected folder and assigns only the originating delivery field", async () => {
  h.template.mockResolvedValue({
    categoryId: id,
    version: 2,
    definition: {
      name: "Delivery",
      description: "",
      prices: [],
      fields: [
        { key: "video", label: "Video", type: "attachment", required: true, instructions: "" },
        { key: "source", label: "Source", type: "attachment", required: false, instructions: "" },
      ],
    },
  });
  h.folders.mockResolvedValue([
    { id, parentId: null, name: "Deliveries", effectivePermission: "upload" },
  ]);
  await render();
  await act(async () =>
    button("taskSubmit.deliveryFolder: taskSubmit.automaticDeliveryFolder")!.click()
  );
  await act(async () => button("Deliveries")!.click());
  await act(async () => button("thread.uploadFile")!.click());
  expect(h.uploadProps.mock.lastCall?.[0]).toMatchObject({
    crewId: "crew",
    userId: "1",
    generation: 1,
    parentId: id,
  });
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => button("finish upload")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(false);
  expect(button("● Uploaded.mp4")).toBeDefined();
  expect(button("○ Uploaded.mp4")).toBeDefined();
  await act(async () => button("taskSubmit.submitAction")!.click());
  expect(h.submit.mock.calls[0]?.[2]).toMatchObject({
    assetNodeIds: ["22222222-2222-4222-8222-222222222222"],
    deliveryFolderId: id,
    professionalDelivery: { answers: { video: ["22222222-2222-4222-8222-222222222222"] } },
  });
  expect(h.submit.mock.calls[0]?.[2].professionalDelivery.answers.source).toBeUndefined();
});
it("ignores a delivery upload callback after the account changes", async () => {
  h.template.mockResolvedValue({
    categoryId: id,
    version: 2,
    definition: {
      name: "Delivery",
      description: "",
      prices: [],
      fields: [
        { key: "video", label: "Video", type: "attachment", required: true, instructions: "" },
      ],
    },
  });
  await render();
  await act(async () => button("thread.uploadFile")!.click());
  h.generation = 2;
  await act(async () => button("finish upload")!.click());
  expect(host.textContent).not.toContain("Uploaded.mp4");
  expect(h.submit).not.toHaveBeenCalled();
});

function Journey() {
  const [snapshot, setSnapshot] = useState(task);
  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setSnapshot({ ...task });
    setRevision((n) => n + 1);
  };
  const session = useTaskSubmitSession(task.id, 1, refresh);
  return (
    <>
      <button onClick={refresh}>Reload details</button>
      <TaskSubmit
        key={revision}
        task={snapshot}
        userId="1"
        generation={1}
        onRefresh={refresh}
        session={session}
      />
    </>
  );
}
const template = {
  categoryId: id,
  version: 2,
  definition: {
    name: "Delivery",
    description: "",
    prices: [],
    fields: [{ key: "brief", label: "Brief", type: "text", required: true, instructions: "" }],
  },
};
it("retains delivery inputs through an uncertain submission and detail reload", async () => {
  h.template.mockResolvedValue(template);
  h.folders.mockResolvedValue([
    { id, parentId: null, name: "Deliveries", effectivePermission: "upload" },
  ]);
  h.submit.mockRejectedValue(new Error("Response interrupted"));
  await act(async () => root.render(<Journey />));
  await act(async () => type(0, "Delivery note"));
  await act(async () => type(1, "Completed storyboard"));
  await act(async () => button("crewAssets.choose · 0/100")!.click());
  await act(async () => button("pick file")!.click());
  await act(async () =>
    button("taskSubmit.deliveryFolder: taskSubmit.automaticDeliveryFolder")!.click()
  );
  await act(async () => button("Deliveries")!.click());
  await act(async () => button("taskSubmit.submitAction")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(host.querySelectorAll("input")[0]!.value).toBe("Delivery note");
  expect(host.querySelectorAll("input")[1]!.value).toBe("Completed storyboard");
  expect(button("Final.mp4 ×")).toBeDefined();
  expect(button("taskSubmit.deliveryFolder: Deliveries")).toBeDefined();
  expect(button("taskSubmit.submitAction")!.disabled).toBe(false);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("does not rebind delivery answers to a different template version", async () => {
  h.template.mockResolvedValue(template);
  await act(async () => root.render(<Journey />));
  await act(async () => type(0, "Keep my note"));
  await act(async () => type(1, "Original requirements"));
  h.template.mockResolvedValue({ ...template, version: 3 });
  await act(async () => button("Reload details")!.click());
  expect(host.querySelectorAll("input")[0]!.value).toBe("Keep my note");
  expect(host.querySelectorAll("input")[1]!.value).toBe("");
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  h.template.mockResolvedValue(template);
  await act(async () => button("Reload details")!.click());
  expect(host.querySelectorAll("input")[1]!.value).toBe("Original requirements");
});
it("keeps pending submissions locked through reload and requires a new read after failure", async () => {
  let fail!: (error: Error) => void;
  h.submit.mockImplementation(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      })
  );
  await act(async () => root.render(<Journey />));
  await act(async () => button("taskSubmit.submitAction")!.click());
  await act(async () => button("Reload details")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => fail(new Error("Response lost")));
  expect(button("taskSubmit.submitAction")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(button("taskSubmit.submitAction")!.disabled).toBe(false);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("ignores an upload callback from a retired form after refreshing details", async () => {
  h.template.mockResolvedValue({
    ...template,
    definition: {
      ...template.definition,
      fields: [
        { key: "video", label: "Video", type: "attachment", required: true, instructions: "" },
      ],
    },
  });
  await act(async () => root.render(<Journey />));
  await act(async () => button("thread.uploadFile")!.click());
  const old = h.uploadProps.mock.lastCall![0];
  await act(async () => button("Reload details")!.click());
  await act(async () => old.onAttached({ id, name: "Retired.mp4" }));
  expect(host.textContent).not.toContain("Retired.mp4");
});
it("retires the submission draft when the account changes", async () => {
  await render();
  await act(async () => type(0, "Private delivery"));
  h.generation = 2;
  await act(async () =>
    root.render(<TaskSubmit task={task} userId="2" generation={2} onRefresh={h.refresh} />)
  );
  expect(host.querySelector("input")!.value).toBe("");
});
