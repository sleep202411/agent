import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskPlanningSession } from "./use-task-planning-session";
import { TaskPlanningEditor } from "./task-planning-editor";
import type { TaskDetail } from "./task-detail-api";
vi.mock("@/features/crew-assets/asset-picker", () => ({ CrewAssetPicker: () => null }));
vi.mock("./task-contract", () => ({ TaskContract: () => null }));
vi.mock("@/features/crew-assets/file-upload", () => ({ AssetFileUpload: () => null }));
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  templates: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./task-kind-api", async (original) => ({
  ...(await original<typeof import("./task-kind-api")>()),
  fetchTaskKindTemplates: h.templates,
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-planning-edit-api", async (original) => ({
  ...(await original<typeof import("./task-planning-edit-api")>()),
  updateTaskPlanning: h.update,
  fetchTaskPlanning: h.fetch,
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
let host: HTMLDivElement, root: Root;
const render = (value = task) =>
  act(async () =>
    root.render(<TaskPlanningEditor task={value} userId="1" generation={1} onRefresh={h.refresh} />)
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue({
    ...task,
    taskKind: "storyboard",
    estimatePoints: 8,
    cycleId: "11111111-1111-4111-8111-111111111111",
    cycle: { id: "11111111-1111-4111-8111-111111111111", name: "Sprint" },
    episodeId: null,
    episode: null,
  });
  h.access.mockResolvedValue({ allowed: false, canManage: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
it("requires manager access and hides closed-task editing", async () => {
  h.access.mockResolvedValueOnce({ allowed: true, canManage: false });
  await render();
  expect(button("taskPlanning.edit")).toBeUndefined();
  await render({ ...task, version: 5 });
  expect(button("taskPlanning.edit")).toBeDefined();
  for (const status of ["approved", "cancelled"]) {
    await render({ ...task, status });
    expect(host.textContent).toBe("");
  }
});
it("preserves planning fields until explicitly changed and guards duplicate saves", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.textContent).toContain("Sprint");
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => {
    button("taskPlanning.save")!.click();
    button("taskPlanning.save")!.click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 4 }), {
    expectedVersion: 4,
    cycleId: null,
  });
  expect(button("myServices.cancel")!.disabled).toBe(true);
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("requires refresh when the fresh planning snapshot cannot load", async () => {
  h.fetch.mockRejectedValue(new Error("Task changed"));
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.textContent).toContain("Task changed");
  expect(button("taskPlanning.save")).toBeUndefined();
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("cancels an unsaved edit without writing and reloads the original snapshot", async () => {
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => button("myServices.cancel")!.click());
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.textContent).toContain("Sprint");
  expect(h.update).not.toHaveBeenCalled();
});
it("freezes a conflicted draft and refreshes before another attempt", async () => {
  h.update.mockRejectedValue(new Error("Version changed"));
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  expect(host.textContent).toContain("Version changed");
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  await act(async () => button("myServices.cancel")!.click());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("ignores save completion after an account change", async () => {
  let finish!: () => void;
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  h.generation = 2;
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
it("aborts snapshot reads on unmount", async () => {
  h.fetch.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  const signal = h.fetch.mock.calls[0]![1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("edits the existing kind without loading or applying creation templates", async () => {
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(button("taskKind.storyboard")).toBeDefined();
  await act(async () => button("taskKind.storyboard")!.click());
  await act(async () => button("taskKind.art")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.templates).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Shot", description: "Brief", taskKind: "storyboard" }),
    { expectedVersion: 4, taskKind: "art" }
  );
});
it("supports explicitly clearing the kind", async () => {
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskKind.storyboard")!.click());
  await act(async () => button("taskKind.unset")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), { expectedVersion: 4, taskKind: null });
});

const typeNumber = (index: number, value: string) => {
  const input = host.querySelectorAll("input")[index]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
it("preserves numeric values and saves only changed estimates and limits", async () => {
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.querySelectorAll("input")[0]!.value).toBe("8");
  expect(host.querySelectorAll("input")[1]!.value).toBe("");
  await act(async () => {
    typeNumber(0, "0");
    typeNumber(1, "3");
  });
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), {
    expectedVersion: 4,
    estimatePoints: 0,
    revisionLimit: 3,
  });
});
it("disables saving fractional or below-usage limits while retaining the draft", async () => {
  const snapshot = await h.fetch();
  h.fetch.mockResolvedValue({ ...snapshot, revisionRoundsUsed: 2 });
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => typeNumber(1, "1"));
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  await act(async () => typeNumber(1, "2"));
  expect(button("taskPlanning.save")!.disabled).toBe(false);
  await act(async () => typeNumber(0, "1.5"));
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  expect(host.querySelectorAll("input")[0]!.value).toBe("1.5");
  expect(h.update).not.toHaveBeenCalled();
});
it("clears numeric values explicitly instead of converting them to zero", async () => {
  const snapshot = await h.fetch();
  h.fetch.mockResolvedValue({ ...snapshot, revisionLimit: 3 });
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => {
    typeNumber(0, "");
    typeNumber(1, "");
  });
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), {
    expectedVersion: 4,
    estimatePoints: null,
    revisionLimit: null,
  });
});

it("loads compensation in display units and clears only the chosen term", async () => {
  const snapshot = await h.fetch();
  h.fetch.mockResolvedValue({ ...snapshot, rewardUsdMinor: 12345, profitShareBps: 125 });
  h.update.mockResolvedValue({});
  await render();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.querySelectorAll("input")[2]!.value).toBe("123.45");
  expect(host.querySelectorAll("input")[3]!.value).toBe("1.25");
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  await act(async () => typeNumber(2, ""));
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), {
    expectedVersion: 4,
    rewardUsdMinor: null,
  });
});

function RefreshingPlanning({ value, visible }: { value: TaskDetail; visible: boolean }) {
  const session = useTaskPlanningSession(value.id, 1, h.refresh);
  return visible ? (
    <TaskPlanningEditor
      key={value.version}
      task={value}
      userId="1"
      generation={1}
      onRefresh={h.refresh}
      session={session}
    />
  ) : null;
}
const refreshRender = (value = task, visible = true) =>
  act(async () => root.render(<RefreshingPlanning value={value} visible={visible} />));
it("retains planning changes across reload and requires review before adopting the new version", async () => {
  await refreshRender();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await refreshRender(task, false);
  const latest = { ...task, version: 5 };
  const snapshot = { ...(await h.fetch()), version: 5, estimatePoints: 13 };
  h.fetch.mockResolvedValue(snapshot);
  await refreshRender(latest);
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  expect(host.textContent).toContain("taskPlanning.latest");
  await act(async () => button("taskBrief.reviewLatest")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledExactlyOnceWith(snapshot, {
    expectedVersion: 5,
    cycleId: null,
    estimatePoints: 8,
  });
});
it("keeps a pending planning write locked through remount and preserves failure details", async () => {
  let fail!: (e: Error) => void;
  h.update.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  await refreshRender();
  await act(async () => button("taskPlanning.edit")!.click());
  await act(async () => button("taskPlanning.clearCycle")!.click());
  await act(async () => button("taskPlanning.save")!.click());
  await refreshRender(task, false);
  h.fetch.mockResolvedValue({ ...(await h.fetch()) });
  await refreshRender({ ...task });
  expect(button("taskPlanning.save")!.disabled).toBe(true);
  expect(button("myServices.cancel")!.disabled).toBe(true);
  expect(button("taskBrief.reviewLatest")).toBeUndefined();
  await act(async () => fail(new Error("Planning conflict")));
  expect(host.textContent).toContain("Planning conflict");
  expect(h.update).toHaveBeenCalledOnce();
  await act(async () => button("taskBrief.reviewLatest")!.click());
  expect(button("taskPlanning.save")!.disabled).toBe(false);
});

it("retains a position draft through background reload and saves the trimmed role", async () => {
  const snapshot = await h.fetch();
  h.fetch.mockResolvedValue({ ...snapshot, positionRole: "Writer" });
  h.update.mockResolvedValue({});
  await refreshRender();
  await act(async () => button("taskPlanning.edit")!.click());
  expect(host.querySelectorAll("input")[4]!.value).toBe("Writer");
  await act(async () => typeNumber(4, " Storyboard artist "));
  await refreshRender(task, false);
  await refreshRender(task, true);
  expect(host.querySelectorAll("input")[4]!.value).toBe(" Storyboard artist ");
  await act(async () => button("taskPlanning.save")!.click());
  expect(h.update).toHaveBeenCalledWith(expect.anything(), {
    expectedVersion: 4,
    positionRole: "Storyboard artist",
  });
});
