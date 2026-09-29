import { beforeEach, expect, it, vi } from "vitest";
import { closeTask } from "./task-closure-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const task = { id: "00000000-0000-4000-8000-000000000001", crewId: "crew" };
const body = {
  requestId: "00000000-0000-4000-8000-000000000002",
  expectedVersion: 3,
  reason: "Work is no longer required",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.post.mockResolvedValue({ ...task, status: "cancelled", version: 4 });
});
it("sends reason, version and stable request identity", async () => {
  await closeTask(task, "manager", 1, body);
  expect(h.post).toHaveBeenCalledWith(`/crew-tasks/${task.id}/close`, {
    service: "aurora",
    data: body,
  });
});
it.each(["", " ", "x".repeat(4001)])("rejects invalid reasons", async (reason) => {
  await expect(closeTask(task, "manager", 1, { ...body, reason })).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects permission loss", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await expect(closeTask(task, "manager", 1, body)).rejects.toMatchObject({ status: 403 });
  expect(h.post).not.toHaveBeenCalled();
});
it.each([
  { id: "00000000-0000-4000-8000-000000000003" },
  { crewId: "other" },
  { status: "approved" },
  { version: 3 },
])("rejects unverified closure receipt", async (changed) => {
  h.post.mockResolvedValue({ ...task, status: "cancelled", version: 4, ...changed });
  await expect(closeTask(task, "manager", 1, body)).rejects.toThrow();
});
it("accepts a newer cancelled task on identical recovery", async () => {
  h.post.mockResolvedValue({ ...task, status: "cancelled", version: 7 });
  await closeTask(task, "manager", 1, body);
});
it("does not retry automatically after a lost response", async () => {
  h.post.mockRejectedValue(new Error("offline"));
  await expect(closeTask(task, "manager", 1, body)).rejects.toThrow("offline");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects stale accounts before and after permission reads", async () => {
  h.generation = 2;
  await expect(closeTask(task, "manager", 1, body)).rejects.toThrow("expired");
  h.generation = 1;
  h.access.mockImplementation(async () => {
    h.generation = 2;
    return { canManage: true };
  });
  await expect(closeTask(task, "manager", 1, body)).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects account changes after write", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { ...task, status: "cancelled", version: 4 };
  });
  await expect(closeTask(task, "manager", 1, body)).rejects.toThrow("expired");
});
