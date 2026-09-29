import { beforeEach, expect, it, vi } from "vitest";
import { deleteTask } from "./task-delete-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { delete: h.delete } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const task = { id: "00000000-0000-4000-8000-000000000001", crewId: "crew", version: 4 };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.delete.mockResolvedValue(undefined);
});
it("sends the captured version in DELETE body", async () => {
  await deleteTask(task, "manager", 1);
  expect(h.delete).toHaveBeenCalledWith(`/crew-tasks/${task.id}`, {
    service: "aurora",
    data: { expectedVersion: 4 },
  });
});
it("checks management permission", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await expect(deleteTask(task, "manager", 1)).rejects.toThrow("permission");
  expect(h.delete).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5])("rejects invalid version %s", async (version) => {
  await expect(deleteTask({ ...task, version }, "manager", 1)).rejects.toThrow();
  expect(h.delete).not.toHaveBeenCalled();
});
it.each([404, 409, 500])("does not reinterpret or retry status %s", async (status) => {
  const error = Object.assign(new Error("failed"), { status });
  h.delete.mockRejectedValue(error);
  await expect(deleteTask(task, "manager", 1)).rejects.toBe(error);
  expect(h.delete).toHaveBeenCalledOnce();
});
it("rejects stale account before and after permission read", async () => {
  h.generation = 2;
  await expect(deleteTask(task, "manager", 1)).rejects.toThrow("expired");
  h.generation = 1;
  h.access.mockImplementation(async () => {
    h.generation = 2;
    return { canManage: true };
  });
  await expect(deleteTask(task, "manager", 1)).rejects.toThrow("expired");
  expect(h.delete).not.toHaveBeenCalled();
});
it("rejects stale account after deletion", async () => {
  h.delete.mockImplementation(async () => {
    h.generation = 2;
  });
  await expect(deleteTask(task, "manager", 1)).rejects.toThrow("expired");
});
