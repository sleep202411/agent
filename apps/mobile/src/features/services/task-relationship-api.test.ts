import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { updateTaskRelationships } from "./task-relationship-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
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
const relatedId = "22222222-2222-4222-8222-222222222222";
const related = {
  id: relatedId,
  number: 2,
  title: "Other",
  status: "open",
  workflowState: { name: "Open" },
  parentId: null,
};
beforeEach(() => vi.resetAllMocks());
it("sends versioned relationship changes and accepts matching acknowledgements", async () => {
  const input = { expectedVersion: 1, parentId: relatedId, blockedByTaskIds: [relatedId] };
  vi.mocked(api.patch).mockResolvedValue({
    ...detail,
    version: 2,
    parent: related,
    blockedBy: [{ ...related, resolved: false }],
  });
  await updateTaskRelationships(detail, input);
  expect(api.patch).toHaveBeenCalledWith(`/crew-tasks/${id}`, { service: "aurora", data: input });
});
it("supports explicit removal and rejects mismatched scope, version and relationship responses", async () => {
  const input = { expectedVersion: 1, parentId: null, blockedByTaskIds: [] };
  vi.mocked(api.patch).mockResolvedValue({ ...detail, version: 2 });
  await updateTaskRelationships(detail, input);
  for (const change of [
    { crewId: "other" },
    { version: 1 },
    { parent: related },
    { blockedBy: [{ ...related, resolved: false }] },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({ ...detail, version: 2, ...change });
    await expect(updateTaskRelationships(detail, input)).rejects.toThrow(
      "acknowledgement mismatch"
    );
  }
});
it("rejects self references, duplicate blockers and excessive blockers before writing", async () => {
  for (const change of [
    { parentId: id },
    { blockedByTaskIds: [id] },
    { blockedByTaskIds: [relatedId, relatedId] },
    { blockedByTaskIds: Array(51).fill(relatedId) },
  ]) {
    await expect(
      updateTaskRelationships(detail, {
        expectedVersion: 1,
        parentId: null,
        blockedByTaskIds: [],
        ...change,
      })
    ).rejects.toThrow();
  }
  expect(api.patch).not.toHaveBeenCalled();
});
it("preserves server cycle/conflict errors without retrying", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Circular dependency"));
  await expect(
    updateTaskRelationships(detail, {
      expectedVersion: 1,
      parentId: null,
      blockedByTaskIds: [relatedId],
    })
  ).rejects.toThrow("Circular dependency");
  expect(api.patch).toHaveBeenCalledOnce();
});
