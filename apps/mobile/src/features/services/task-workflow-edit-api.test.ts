import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskWorkflow, moveTaskWorkflow } from "./task-workflow-edit-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
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

const other = "22222222-2222-4222-8222-222222222222";
const workflow = { id, crewId: "crew", name: "Open", semantic: "open" as const, archived: false };
const snapshot = { ...detail, status: "open", workflowStateId: id, workflowState: workflow };
const target = { ...workflow, id: other, name: "Working", semantic: "in_progress" as const };
beforeEach(() => vi.resetAllMocks());
it("requires an exact, movable workflow snapshot", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue(snapshot);
  expect(await fetchTaskWorkflow(snapshot, signal)).toEqual(snapshot);
  for (const change of [
    { version: 2 },
    { crewId: "wrong" },
    { workflowStateId: other },
    { workflowState: { ...workflow, crewId: "wrong" } },
    { status: "submitted", workflowState: { ...workflow, semantic: "submitted" } },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, ...change });
    await expect(fetchTaskWorkflow(snapshot, signal)).rejects.toThrow();
  }
});
it("sends a versioned move and validates the resulting column and semantic", async () => {
  vi.mocked(api.patch).mockResolvedValue({
    ...snapshot,
    version: 2,
    status: "in_progress",
    workflowStateId: other,
    workflowState: target,
  });
  await expect(moveTaskWorkflow(snapshot, target)).resolves.toMatchObject({
    workflowStateId: other,
    status: "in_progress",
  });
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data: { expectedVersion: 1, workflowStateId: other },
  });
});
it("rejects archived, cross-Crew, unchanged and action-only destinations before writes", async () => {
  for (const selected of [
    workflow,
    { ...target, archived: true },
    { ...target, crewId: "other" },
    ...(["submitted", "approved", "cancelled"] as const).map((semantic) => ({
      ...target,
      semantic,
    })),
  ]) {
    await expect(moveTaskWorkflow(snapshot, selected)).rejects.toThrow();
  }
  for (const status of ["submitted", "approved", "cancelled"])
    await expect(moveTaskWorkflow({ ...snapshot, status }, target)).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects wrong scope, version or final workflow acknowledgements", async () => {
  for (const change of [
    { version: 1 },
    { id: other },
    { crewId: "wrong" },
    { status: "open", workflowState: workflow, workflowStateId: id },
    { status: "revision_requested", workflowState: { ...target, semantic: "revision_requested" } },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({
      ...snapshot,
      version: 2,
      status: "in_progress",
      workflowStateId: other,
      workflowState: target,
      ...change,
    });
    await expect(moveTaskWorkflow(snapshot, target)).rejects.toThrow();
  }
});
it("preserves server conflict messages and never automatically retries moves", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Review the current submission"));
  await expect(moveTaskWorkflow(snapshot, target)).rejects.toThrow("Review the current submission");
  expect(api.patch).toHaveBeenCalledOnce();
});
