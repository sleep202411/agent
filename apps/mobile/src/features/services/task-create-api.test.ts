import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createTask } from "./task-create-api";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));

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
const input = {
  title: " Shot ",
  description: " Render ",
  priority: "normal" as const,
  startAt: null,
  dueAt: detail.dueAt,
  assignees: [],
};
beforeEach(() => vi.resetAllMocks());
it("creates a task using the existing server defaults without granting rewards", async () => {
  vi.mocked(api.post).mockResolvedValue(detail);
  await createTask("crew", input);
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/tasks", {
    service: "aurora",
    data: { ...input, title: "Shot", description: "Render" },
  });
});
it("rejects blank/oversized fields, duplicate assignees and date inversion before writes", async () => {
  for (const change of [
    { title: " " },
    { title: "x".repeat(181) },
    { description: "x".repeat(10001) },
    { startAt: "2027-01-01T00:00:00Z" },
    {
      assignees: [
        { userId: "1", currency: "USD" as const },
        { userId: "1", currency: "USD" as const },
      ],
    },
  ])
    await expect(createTask("crew", { ...input, ...change })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("requires returned Crew, content, dates and assignments to match", async () => {
  for (const change of [
    { crewId: "other" },
    { title: "Wrong" },
    { description: "Wrong" },
    { priority: "urgent" },
    { dueAt: null },
    { assignees: [{ id, userId: "other" }] },
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, ...change });
    await expect(createTask("crew", input)).rejects.toThrow("acknowledgement");
  }
});
it("does not retry failed creation automatically", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Offline"));
  await expect(createTask("crew", input)).rejects.toThrow("Offline");
  expect(api.post).toHaveBeenCalledOnce();
});
