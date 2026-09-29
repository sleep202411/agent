import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { editableView, settingsOf } from "./task-view-edit-api";
import {
  copiedViewSettings,
  createTaskView,
  deleteTaskView,
  fetchViewLifecycleContext,
} from "./task-view-lifecycle-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn(), delete: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-view-edit-api", async (original) => ({
  ...(await original<typeof import("./task-view-edit-api")>()),
  fetchViewEditProject: h.project,
}));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (n = 1, system = false) =>
  editableView.parse({
    id: uid(n),
    crewId: "crew",
    name: "Planning",
    layout: "list",
    groupBy: null,
    filters: { priorities: ["high"], cycleIds: [uid(8)] },
    sorts: [{ field: "dueAt", direction: "desc" }],
    visibleFields: [`custom:${uid(9)}`],
    completedMode: "hidden",
    showSubIssues: false,
    showEmptyGroups: true,
    updatedAt: "2026-09-30T00:00:00.000Z",
    isSystem: system,
  });
const input = { name: " New View ", layout: "list" as const };
const read = () => fetchViewLifecycleContext("crew", uid(1), "1", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.project.mockResolvedValue({ views: [view(), view(2), view(3, true)] });
  vi.mocked(api.post).mockImplementation(async (_path, options) => ({
    ...view(4),
    ...(options?.data as object),
  }));
  vi.mocked(api.delete).mockResolvedValue(undefined);
});
it("loads source and prefers a system fallback over server order", async () => {
  const result = await read();
  expect(result.view).toEqual(view());
  expect(result.fallbackId).toBe(uid(3));
});
it("uses another non-system view when necessary", async () => {
  h.project.mockResolvedValue({ views: [view(), view(2)] });
  expect((await read()).fallbackId).toBe(uid(2));
});
it("rejects missing source, invalid IDs and denied access", async () => {
  h.project.mockResolvedValue({ views: [] });
  await expect(read()).rejects.toThrow("no longer available");
  h.access.mockResolvedValue({ canManage: false });
  await expect(read()).rejects.toThrow("permission");
  h.access.mockClear();
  await expect(
    fetchViewLifecycleContext("../crew", uid(1), "1", 1, new AbortController().signal)
  ).rejects.toThrow();
  expect(h.access).not.toHaveBeenCalled();
});
it("copies exact settings and applies Web layout/grouping defaults", () => {
  expect(copiedViewSettings(view(), input)).toEqual({
    ...settingsOf(view()),
    name: "New View",
    groupBy: "status",
  });
  expect(copiedViewSettings({ ...view(), groupBy: "cycle" }, input).groupBy).toBe("cycle");
  expect(
    copiedViewSettings({ ...view(), groupBy: "cycle" }, { ...input, layout: "board" }).groupBy
  ).toBe("status");
});
it("creates only after a fresh scoped read and verifies the new receipt", async () => {
  const result = await createTaskView(view(), input, "1", 1);
  expect(result.id).toBe(uid(4));
  expect(api.post).toHaveBeenCalledWith("/crews/crew/task-views", {
    service: "aurora",
    data: copiedViewSettings(view(), input),
  });
  expect(h.access).toHaveBeenCalledOnce();
  expect(h.project).toHaveBeenCalledOnce();
});
it.each(["version", "settings", "system"])(
  "rejects changed source %s before creation",
  async (mode) => {
    const fresh = view();
    if (mode === "version") fresh.updatedAt = "2026-09-30T00:00:01.000Z";
    if (mode === "settings") fresh.filters = {};
    if (mode === "system") fresh.isSystem = true;
    h.project.mockResolvedValue({ views: [fresh, view(2)] });
    await expect(createTaskView(view(), input, "1", 1)).rejects.toThrow("changed");
    expect(api.post).not.toHaveBeenCalled();
  }
);
it.each(["scope", "existing", "system", "settings"])(
  "rejects invalid creation receipt %s",
  async (mode) => {
    const result = { ...view(4), ...copiedViewSettings(view(), input) };
    if (mode === "scope") result.crewId = "other";
    if (mode === "existing") result.id = uid(2);
    if (mode === "system") result.isSystem = true;
    if (mode === "settings") result.filters = {};
    vi.mocked(api.post).mockResolvedValue(result);
    await expect(createTaskView(view(), input, "1", 1)).rejects.toThrow("could not be verified");
    expect(api.post).toHaveBeenCalledOnce();
  }
);
it("deletes a fresh non-system view and returns fallback without deleting tasks", async () => {
  expect(await deleteTaskView(view(), "1", 1)).toBe(uid(3));
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/crew-task-views/${uid(1)}`, {
    service: "aurora",
  });
});
it("protects built-ins and the last view", async () => {
  await expect(deleteTaskView(view(1, true), "1", 1)).rejects.toThrow("Built-in");
  expect(h.access).not.toHaveBeenCalled();
  h.project.mockResolvedValue({ views: [view()] });
  await expect(deleteTaskView(view(), "1", 1)).rejects.toThrow("at least one");
  expect(api.delete).not.toHaveBeenCalled();
});
it("rejects observed changes before deleting", async () => {
  h.project.mockResolvedValue({ views: [{ ...view(), name: "Changed" }, view(2)] });
  await expect(deleteTaskView(view(), "1", 1)).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("does not treat a missing deletion receipt as success on 404 or retry", async () => {
  vi.mocked(api.delete).mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
  await expect(deleteTaskView(view(), "1", 1)).rejects.toThrow("Not found");
  expect(api.delete).toHaveBeenCalledOnce();
});
it("does not retry an uncertain creation", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(createTaskView(view(), input, "1", 1)).rejects.toThrow("Connection lost");
  expect(api.post).toHaveBeenCalledOnce();
});
it.each(["access", "project"])("blocks writes after account changes during %s", async (step) => {
  if (step === "access")
    h.access.mockImplementation(async () => {
      h.generation++;
      return { canManage: true };
    });
  else
    h.project.mockImplementation(async () => {
      h.generation++;
      return { views: [view(), view(2)] };
    });
  await expect(createTaskView(view(), input, "1", 1)).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("ignores write completion after account change", async () => {
  vi.mocked(api.delete).mockImplementation(async () => {
    h.generation++;
  });
  await expect(deleteTaskView(view(), "1", 1)).rejects.toThrow("expired");
});
it("rejects invalid names before fetching or writing", async () => {
  await expect(createTaskView(view(), { ...input, name: " " }, "1", 1)).rejects.toThrow();
  expect(h.access).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("stops aborted reads before loading project", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchViewLifecycleContext("crew", uid(1), "1", 1, c.signal)).rejects.toThrow(
    "cancelled"
  );
  expect(h.project).not.toHaveBeenCalled();
});
