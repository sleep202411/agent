import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchBatchTasks, submitTaskBatch, canBatchTask, type BatchTask } from "./task-batch-api";
const h = vi.hoisted(() => ({ generation: 1, manage: true, position: true }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-comment-api", () => ({
  fetchTaskCommentAccess: async () => ({ canManage: h.manage }),
}));
vi.mock("./position-create-api", () => ({
  fetchPositionCreateAccess: async () => ({ canLinkTask: h.position }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const task: BatchTask = {
  id,
  crewId: "crew",
  title: "Script",
  number: 1,
  version: 4,
  status: "open",
  isRecruiting: false,
  assignees: [],
  requiredSkills: [],
  rewardUsdMinor: 1000,
  rewardCurrency: "CNY",
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.manage = true;
  h.position = true;
  vi.mocked(api.post).mockResolvedValue({ taskIds: [id] });
});
it("sends one atomic batch with captured versions; leaves compensation to the server", async () => {
  await submitTaskBatch("crew", "owner", 1, [task], "assign", "creator");
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/tasks/batch-assign", {
    service: "aurora",
    data: { tasks: [{ id, expectedVersion: 4 }], assigneeId: "creator" },
  });
});
it.each([{ status: "approved" }, { isRecruiting: true }, { assignees: [{ userId: "someone" }] }])(
  "blocks unavailable task %j",
  async (change) => {
    expect(canBatchTask({ ...task, ...change })).toBe(false);
    await expect(
      submitTaskBatch("crew", "owner", 1, [{ ...task, ...change }], "assign", "creator")
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("requires recruitment permission and rejects stale generation, foreign crews and duplicates", async () => {
  h.position = false;
  await expect(submitTaskBatch("crew", "owner", 1, [task], "recruit", "director")).rejects.toThrow(
    "permission"
  );
  await expect(submitTaskBatch("other", "owner", 1, [task], "assign", "creator")).rejects.toThrow();
  await expect(
    submitTaskBatch("crew", "owner", 1, [task, task], "assign", "creator")
  ).rejects.toThrow();
  h.generation = 2;
  await expect(submitTaskBatch("crew", "owner", 1, [task], "assign", "creator")).rejects.toThrow(
    "session"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("publishes one grouped position containing each task version", async () => {
  vi.mocked(api.post).mockResolvedValue({
    id,
    crewId: "crew",
    positionType: "director",
    recruitmentVisibility: "public",
  });
  await submitTaskBatch("crew", "owner", 1, [task], "recruit", "director");
  expect(api.post).toHaveBeenCalledWith(
    "/crews/crew/positions",
    expect.objectContaining({
      data: expect.objectContaining({
        tasks: [{ id, expectedVersion: 4 }],
        targetCount: 1,
        recruitmentVisibility: "public",
      }),
    })
  );
});
it("does not load tasks without management permission", async () => {
  h.manage = false;
  await expect(
    fetchBatchTasks("crew", "owner", 1, null, new AbortController().signal)
  ).rejects.toThrow("permission");
  expect(api.get).not.toHaveBeenCalled();
});
