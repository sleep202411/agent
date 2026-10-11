import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskEdit, saveTaskEdit, taskEditDraft, type TaskEditSnapshot } from "./task-edit-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const task: TaskEditSnapshot = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Brief",
  priority: "normal",
  version: 7,
  status: "in_progress",
  revisionLimit: 2,
  revisionRoundsUsed: 0,
  submissions: [],
  children: [],
  blockedBy: [],
  blocking: [],
  parent: null,
  startAt: null,
  dueAt: "2026-01-01T00:00:00Z",
  labels: [],
  workflowStateId: id,
  workflowState: {
    id,
    crewId: "crew",
    name: "In progress",
    semantic: "in_progress",
    archived: false,
  },
  cycle: null,
  cycleId: null,
  episode: null,
  episodeId: null,
  customFieldValues: [],
  paymentTerms: "on_completion",
  rewardCurrency: "CNY",
  rewardUsdMinor: 15000,
  assignees: [{ userId: "1", currency: "CNY", rewardAmountMinor: 15000 }],
};
beforeEach(() => vi.resetAllMocks());
it("restores the saved form and only patches changed fields with the captured version", async () => {
  const draft = taskEditDraft(task);
  expect(draft.review.editor?.workflow?.id).toBe(id);
  expect(draft.input.rewardUsdMinor).toBe(15000);
  vi.mocked(api.patch).mockResolvedValue({ ...task, version: 8, description: "Updated" });
  await saveTaskEdit(task, { ...draft.input, description: "Updated" });
  expect(api.patch).toHaveBeenCalledWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data: { description: "Updated", expectedVersion: 7 },
  });
});
it("does not write unchanged forms or strip retained assignee rewards", async () => {
  await saveTaskEdit(task, taskEditDraft(task).input);
  expect(api.patch).not.toHaveBeenCalled();
  vi.mocked(api.patch).mockResolvedValue({
    ...task,
    version: 8,
    assignees: [...task.assignees, { userId: "2", currency: "CNY", rewardAmountMinor: null }],
  });
  await saveTaskEdit(task, {
    ...taskEditDraft(task).input,
    assignees: [
      { userId: "1", currency: "CNY" },
      { userId: "2", currency: "CNY" },
    ],
  });
  expect(vi.mocked(api.patch).mock.calls[0]![1]!.data).toMatchObject({
    assignees: [{ userId: "1", rewardAmountMinor: 15000 }, { userId: "2" }],
  });
});
it("rejects mismatched scopes, versions and save contents", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...task, crewId: "other" });
  await expect(fetchTaskEdit("crew", id, new AbortController().signal)).rejects.toThrow(
    "scope mismatch"
  );
  for (const patch of [{ crewId: "other" }, { version: 7 }, { description: "Wrong" }]) {
    vi.mocked(api.patch).mockResolvedValue({
      ...task,
      version: 8,
      description: "Updated",
      ...patch,
    });
    await expect(
      saveTaskEdit(task, { ...taskEditDraft(task).input, description: "Updated" })
    ).rejects.toThrow("acknowledgement mismatch");
  }
});
