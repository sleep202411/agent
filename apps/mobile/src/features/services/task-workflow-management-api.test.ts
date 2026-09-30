import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createManagedWorkflow,
  deleteManagedWorkflow,
  fetchManagedWorkflows,
  managedWorkflow,
  reorderManagedWorkflows,
  setWorkflowArchived,
  updateManagedWorkflow,
} from "./task-workflow-management-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = (n = 1) =>
  managedWorkflow.parse({
    id: id(n),
    crewId: "crew",
    name: `State ${n}`,
    color: "#aabbcc",
    semantic: "in_progress",
    systemKey: null,
    archived: false,
    position: n - 1,
    version: 2,
    taskCount: 0,
  });
const read = () => fetchManagedWorkflows("crew", "1", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [state(), state(2)] });
  vi.mocked(api.patch).mockImplementation(async (_, options) => ({
    ...state(),
    ...(options?.data as object),
    version: 3,
  }));
  vi.mocked(api.delete).mockResolvedValue(undefined);
});
it("reads scoped states with task counts", async () => {
  expect(await read()).toEqual([state(), state(2)]);
});
it.each(["foreign", "duplicate", "missing count"])("rejects %s project data", async (mode) => {
  const row = {
    ...state(),
    ...(mode === "foreign"
      ? { crewId: "other" }
      : mode === "missing count"
        ? { taskCount: undefined }
        : {}),
  };
  vi.mocked(api.get).mockResolvedValue({
    workflowStates: mode === "duplicate" ? [row, row] : [row],
  });
  await expect(read()).rejects.toThrow();
});
it("denies read without management permission", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await expect(read()).rejects.toThrow("permission");
  expect(api.get).not.toHaveBeenCalled();
});
it("drops a response after account switch", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return { workflowStates: [state()] };
  });
  await expect(read()).rejects.toThrow("session");
});
it("creates with normalized settings and insertion anchor", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...state(3), name: "New", version: 1 });
  await createManagedWorkflow("crew", "1", 1, {
    name: " New ",
    color: "#aabbcc",
    semantic: "in_progress",
    afterStateId: id(2),
  });
  expect(api.post).toHaveBeenCalledWith("/crews/crew/task-workflow-states", {
    service: "aurora",
    data: { name: "New", color: "#AABBCC", semantic: "in_progress", afterStateId: id(2) },
  });
});
it("rejects duplicate names case insensitively", async () => {
  await expect(
    createManagedWorkflow("crew", "1", 1, {
      name: "STATE 1",
      color: "#aabbcc",
      semantic: "open",
      afterStateId: null,
    })
  ).rejects.toThrow("already exists");
  expect(api.post).not.toHaveBeenCalled();
});
it("sends changed fields and captured version only", async () => {
  await updateManagedWorkflow(state(), "1", 1, { name: "New", color: "#aabbcc" });
  expect(api.patch).toHaveBeenCalledWith(`/crew-task-workflow-states/${id(1)}`, {
    service: "aurora",
    data: { name: "New", expectedVersion: 2 },
  });
});
it("rejects a stale update receipt", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...state(), name: "New" });
  await expect(
    updateManagedWorkflow(state(), "1", 1, { name: "New", color: "#aabbcc" })
  ).rejects.toThrow("verified");
});
it.each(["missing", "self", "semantic", "archived"])(
  "rejects %s archive replacement",
  async (mode) => {
    vi.mocked(api.get).mockResolvedValue({
      workflowStates: [
        { ...state(), taskCount: 1 },
        {
          ...state(2),
          semantic: mode === "semantic" ? "approved" : "in_progress",
          archived: mode === "archived",
        },
        state(3),
      ],
    });
    await expect(
      setWorkflowArchived(
        state(),
        "1",
        1,
        true,
        mode === "missing" ? undefined : mode === "self" ? id(1) : id(2)
      )
    ).rejects.toThrow("replacement");
    expect(api.patch).not.toHaveBeenCalled();
  }
);
it("archives with a compatible replacement", async () => {
  vi.mocked(api.get).mockResolvedValue({
    workflowStates: [{ ...state(), taskCount: 1 }, state(2)],
  });
  await setWorkflowArchived(state(), "1", 1, true, id(2));
  expect(api.patch).toHaveBeenCalledWith(expect.any(String), {
    service: "aurora",
    data: { archived: true, replacementStateId: id(2), expectedVersion: 2 },
  });
});
it("keeps the last active column", async () => {
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [state()] });
  await expect(setWorkflowArchived(state(), "1", 1, true)).rejects.toThrow("at least one");
});
it("restores an archived column", async () => {
  const archived = { ...state(), archived: true };
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [archived, state(2)] });
  await setWorkflowArchived(archived, "1", 1, false);
  expect(api.patch).toHaveBeenCalledWith(expect.any(String), {
    service: "aurora",
    data: { archived: false, expectedVersion: 2 },
  });
});
it("reorders all captured versions and validates returned positions", async () => {
  vi.mocked(api.post).mockResolvedValue([
    { ...state(2), position: 0, version: 3 },
    { ...state(), position: 1, version: 3 },
  ]);
  await reorderManagedWorkflows("crew", "1", 1, [state(2), state()]);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/task-workflow-states/reorder", {
    service: "aurora",
    data: {
      states: [
        { id: id(2), expectedVersion: 2 },
        { id: id(1), expectedVersion: 2 },
      ],
    },
  });
});
it("rejects an unconfirmed reorder", async () => {
  vi.mocked(api.post).mockResolvedValue([state(), state(2)]);
  await expect(reorderManagedWorkflows("crew", "1", 1, [state(2), state()])).rejects.toThrow(
    "verified"
  );
});
it.each(["builtin", "active", "tasks", "stale"])("prevents %s deletion", async (mode) => {
  const row = {
    ...state(),
    archived: mode !== "active",
    systemKey: mode === "builtin" ? "open" : null,
  };
  vi.mocked(api.get).mockResolvedValue({
    workflowStates: [
      { ...row, taskCount: mode === "tasks" ? 1 : 0, version: mode === "stale" ? 3 : 2 },
    ],
  });
  await expect(deleteManagedWorkflow(row, "1", 1)).rejects.toThrow();
  expect(api.delete).not.toHaveBeenCalled();
});
it("deletes an archived custom column after fresh checks", async () => {
  const row = { ...state(), archived: true };
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [row] });
  await deleteManagedWorkflow(row, "1", 1);
  expect(api.delete).toHaveBeenCalledWith(`/crew-task-workflow-states/${id(1)}`, {
    service: "aurora",
  });
});
it("preserves server deletion errors without retry", async () => {
  const row = { ...state(), archived: true };
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [row] });
  vi.mocked(api.delete).mockRejectedValue(new Error("Deleted tasks still reference this column"));
  await expect(deleteManagedWorkflow(row, "1", 1)).rejects.toThrow("Deleted tasks");
  expect(api.delete).toHaveBeenCalledTimes(1);
});
