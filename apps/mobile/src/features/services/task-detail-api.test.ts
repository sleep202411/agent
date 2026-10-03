import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskDetail } from "./task-detail-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const detail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Render",
  submissions: [],
  version: 1,
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  status: "submitted",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
};
beforeEach(() => vi.resetAllMocks());
it("loads authorized task details through the same endpoint as Web", async () => {
  vi.mocked(api.get).mockResolvedValue(detail);
  const signal = new AbortController().signal;
  expect(await fetchTaskDetail("crew", id, signal)).toEqual(detail);
  expect(api.get).toHaveBeenCalledWith(`/crew-tasks/${id}`, { service: "aurora", signal });
});
it("rejects invalid task IDs before requesting and rejects mismatched task/Crew or dates", async () => {
  await expect(fetchTaskDetail("crew", "invalid", new AbortController().signal)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  for (const change of [
    { crewId: "other" },
    { id: "22222222-2222-4222-8222-222222222222" },
    { dueAt: "invalid" },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...detail, ...change });
    await expect(fetchTaskDetail("crew", id, new AbortController().signal)).rejects.toThrow();
  }
});

it("preserves parent, subtask and dependency identities and resolution flags", async () => {
  const related = {
    id: "22222222-2222-4222-8222-222222222222",
    number: 2,
    title: "Dependency",
    status: "approved",
    workflowState: { name: "Approved" },
    parentId: null,
  };
  const value = {
    ...detail,
    parent: related,
    children: [related],
    blockedBy: [{ ...related, resolved: true }],
    blocking: [related],
  };
  vi.mocked(api.get).mockResolvedValue(value);
  expect(await fetchTaskDetail("crew", id, new AbortController().signal)).toEqual(value);
  for (const blockedBy of [
    [{ ...related, resolved: "yes" }],
    [{ ...related, id: "invalid", resolved: false }],
    [{ ...related }],
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...value, blockedBy });
    await expect(fetchTaskDetail("crew", id, new AbortController().signal)).rejects.toThrow();
  }
});
it("preserves the workflow display identity for task and related-task labels", async () => {
  const workflowState = { name: "Director review", systemKey: "submitted" };
  const parent = {
    id: "22222222-2222-4222-8222-222222222222",
    number: 2,
    title: "Parent",
    status: "submitted",
    workflowState,
    parentId: null,
  };
  vi.mocked(api.get).mockResolvedValue({ ...detail, workflowState, parent });
  const result = await fetchTaskDetail("crew", id, new AbortController().signal);
  expect(result.workflowState).toEqual(workflowState);
  expect(result.parent?.workflowState).toEqual(workflowState);
});
