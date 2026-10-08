import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TaskEditForm } from "./task-edit-form";
import type { CreateCrewTaskInput, CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  form: null as unknown as {
    initialInput: CreateCrewTaskInput;
    onSave: (input: CreateCrewTaskInput) => Promise<unknown>;
  },
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useUpdateCrewTask: () => ({ mutateAsync: state.save, isPending: false }),
}));
vi.mock("./task-quick-create", () => ({
  TaskQuickCreate: (props: typeof state.form) => {
    state.form = props;
    return null;
  },
}));
const host = document.createElement("div");
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
const task = {
  id: "saved",
  crewId: "crew",
  version: 7,
  title: "Script",
  description: "Original",
  priority: "high",
  taskKind: "script",
  workflowStateId: "working",
  startAt: "2026-01-01",
  dueAt: "2026-10-23",
  rewardCurrency: "USD",
  rewardUsdMinor: 12500,
  paymentTerms: "monthly",
  requiredSkills: ["writing"],
  positionRole: "writer",
  contractAssetNodeId: "contract",
  computeBudgetPoints: 100,
  revisionLimit: 2,
  blockedBy: [{ id: "dependency" }],
  labels: [{ id: "label" }],
  customFieldValues: [{ fieldId: "custom", value: "retain" }],
  assignees: [{ userId: "member", currency: "USD", rewardAmountMinor: 10000 }],
} as unknown as CrewTaskDTO;
function render(value = task) {
  act(() =>
    root.render(
      <TaskEditForm
        task={value}
        members={[]}
        project={{} as never}
        activeView={{} as never}
        onOpenChange={vi.fn()}
      />
    )
  );
}
it("saves only changed fields on the existing task and retains the original version across refetches", async () => {
  render();
  expect(state.form.initialInput).toMatchObject({
    title: "Script",
    paymentTerms: "monthly",
    rewardUsdMinor: 12500,
    contractAssetNodeId: "contract",
    blockedByTaskIds: ["dependency"],
    labelIds: ["label"],
  });
  render({ ...task, version: 8, description: "Another editor's change" });
  await state.form.onSave({ ...state.form.initialInput, description: "My edit" });
  expect(state.save).toHaveBeenCalledWith({
    taskId: "saved",
    input: { expectedVersion: 7, description: "My edit" },
  });
});
it("removes the assignment explicitly without changing compensation or creating a task", async () => {
  render();
  await state.form.onSave({ ...state.form.initialInput, assignees: [] });
  expect(state.save).toHaveBeenCalledWith({
    taskId: "saved",
    input: { expectedVersion: 7, assignees: [] },
  });
});
it("keeps the user's form on API failure rather than claiming success", async () => {
  render();
  state.save.mockRejectedValueOnce(new Error("Version conflict"));
  await expect(state.form.onSave({ ...state.form.initialInput, title: "Changed" })).rejects.toThrow(
    "Version conflict"
  );
  expect(state.form.initialInput.title).toBe("Script");
});
