import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { updateTaskBrief } from "./task-brief-api";
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
beforeEach(() => vi.resetAllMocks());
it("sends bounded trimmed fields and the captured task version", async () => {
  vi.mocked(api.patch).mockResolvedValue({
    ...detail,
    version: 2,
    title: "New title",
    description: "New brief",
  });
  await updateTaskBrief(detail, {
    expectedVersion: 1,
    title: " New title ",
    description: " New brief ",
  });
  expect(api.patch).toHaveBeenCalledWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data: { expectedVersion: 1, title: "New title", description: "New brief" },
  });
});
it("rejects invalid input before sending", async () => {
  for (const change of [
    { title: " " },
    { title: "x".repeat(181) },
    { description: "x".repeat(10001) },
    { expectedVersion: 0 },
  ]) {
    await expect(
      updateTaskBrief(detail, { expectedVersion: 1, title: "Title", description: "", ...change })
    ).rejects.toThrow();
  }
  expect(api.patch).not.toHaveBeenCalled();
});
it("does not accept wrong task, Crew, version or content acknowledgements", async () => {
  for (const change of [
    { id: "22222222-2222-4222-8222-222222222222" },
    { crewId: "other" },
    { version: 1 },
    { title: "Wrong" },
    { description: "Wrong" },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({ ...detail, version: 2, ...change });
    await expect(
      updateTaskBrief(detail, {
        expectedVersion: 1,
        title: detail.title,
        description: detail.description,
      })
    ).rejects.toThrow("acknowledgement mismatch");
  }
});
it("preserves concurrency conflicts without retrying or rebasing", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("This task changed while you were editing it"));
  await expect(
    updateTaskBrief(detail, { expectedVersion: 1, title: "Changed", description: "" })
  ).rejects.toThrow("changed while");
  expect(api.patch).toHaveBeenCalledOnce();
});
