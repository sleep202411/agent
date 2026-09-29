import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  changedViewSettings,
  editableView,
  fetchViewEditProject,
  saveTaskView,
  settingsOf,
  viewSettings,
} from "./task-view-edit-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = () => ({
  id: uid(1),
  crewId: "crew",
  name: "All",
  layout: "board",
  groupBy: null,
  filters: { overdue: true, priorities: ["high"] },
  sorts: [{ field: "rank", direction: "asc" }],
  visibleFields: ["number", `custom:${uid(3)}`],
  completedMode: "recent",
  showSubIssues: true,
  showEmptyGroups: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  isSystem: true,
});
const snapshot = () => editableView.parse(raw());
const project = () => ({
  views: [raw()],
  workflowStates: [{ id: uid(2), crewId: "crew", name: "Open" }],
  cycles: [],
  labels: [],
  fields: [{ id: uid(3), crewId: "crew", name: "Notes" }],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.get).mockResolvedValue(project());
  vi.mocked(api.patch).mockImplementation(async (_path, options) => ({
    ...raw(),
    ...(options?.data as object),
    updatedAt: "2026-09-30T00:00:01.000Z",
  }));
});
it("reads full scoped settings and normalizes null grouping", async () => {
  const signal = new AbortController().signal;
  const result = await fetchViewEditProject("crew", signal);
  expect(result.views[0]?.groupBy).toBe("none");
  expect(result.views[0]?.visibleFields).toContain(`custom:${uid(3)}`);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
});
it.each(["views", "workflowStates", "fields"] as const)(
  "rejects foreign or duplicate %s",
  async (key) => {
    const data = project();
    data[key][0]!.crewId = "foreign";
    vi.mocked(api.get).mockResolvedValue(data);
    await expect(fetchViewEditProject("crew", new AbortController().signal)).rejects.toThrow(
      "scope mismatch"
    );
    data[key][0]!.crewId = "crew";
    (data[key] as { id: string }[]).push(data[key][0]!);
    await expect(fetchViewEditProject("crew", new AbortController().signal)).rejects.toThrow(
      "scope mismatch"
    );
  }
);
it("sends only changed settings with the captured server timestamp", async () => {
  const view = snapshot();
  await saveTaskView(view, { ...settingsOf(view), name: " Next " }, "1", 1);
  expect(api.patch).toHaveBeenCalledWith(`/crew-task-views/${view.id}`, {
    service: "aurora",
    data: { name: "Next", expectedUpdatedAt: view.updatedAt },
  });
});
it("does not write when unchanged and ignores JSON object key order", async () => {
  const view = snapshot(),
    settings = settingsOf(view);
  settings.filters = { priorities: ["high"], overdue: true };
  expect(changedViewSettings(view, settings)).toEqual({});
  await saveTaskView(view, settings, "1", 1);
  expect(api.patch).not.toHaveBeenCalled();
  expect(h.access).not.toHaveBeenCalled();
});
it("saves all filter/sort/display choices including explicit clearing", async () => {
  const view = snapshot();
  const settings = {
    ...settingsOf(view),
    filters: {},
    sorts: [],
    visibleFields: [],
    completedMode: "hidden" as const,
    showSubIssues: false,
    showEmptyGroups: true,
    groupBy: "priority" as const,
    layout: "list" as const,
  };
  const result = await saveTaskView(view, settings, "1", 1);
  expect(settingsOf(result)).toEqual(settings);
});
it("accepts server JSON key normalization in a changed filter receipt", async () => {
  const view = snapshot();
  vi.mocked(api.patch).mockResolvedValue({
    ...raw(),
    filters: { unassigned: true, overdue: false },
    updatedAt: "2026-09-30T00:00:01.000Z",
  });
  await expect(
    saveTaskView(
      view,
      { ...settingsOf(view), filters: { overdue: false, unassigned: true } },
      "1",
      1
    )
  ).resolves.toBeTruthy();
});
it.each(["scope", "id", "version", "settings"])("rejects incorrect %s receipt", async (mode) => {
  const view = snapshot();
  const receipt = { ...raw(), name: "Next", updatedAt: "2026-09-30T00:00:01.000Z" };
  if (mode === "scope") receipt.crewId = "foreign";
  if (mode === "id") receipt.id = uid(9);
  if (mode === "version") receipt.updatedAt = view.updatedAt;
  if (mode === "settings") receipt.name = "Other";
  vi.mocked(api.patch).mockResolvedValue(receipt);
  await expect(saveTaskView(view, { ...settingsOf(view), name: "Next" }, "1", 1)).rejects.toThrow(
    "could not be verified"
  );
});
it("checks manager permission and account before sending", async () => {
  const view = snapshot(),
    settings = { ...settingsOf(view), name: "Next" };
  h.access.mockResolvedValue({ canManage: false });
  await expect(saveTaskView(view, settings, "1", 1)).rejects.toThrow("permission");
  h.access.mockImplementation(async () => {
    h.generation++;
    return { canManage: true };
  });
  await expect(saveTaskView(view, settings, "1", 1)).rejects.toThrow("expired");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects account changes after the write and never retries conflicts", async () => {
  const view = snapshot(),
    settings = { ...settingsOf(view), name: "Next" };
  vi.mocked(api.patch).mockImplementation(async () => {
    h.generation++;
    return { ...raw(), name: "Next", updatedAt: "2026-09-30T00:00:01.000Z" };
  });
  await expect(saveTaskView(view, settings, "1", 1)).rejects.toThrow("expired");
  h.generation = 1;
  vi.mocked(api.patch).mockRejectedValue(new Error("View changed"));
  await expect(saveTaskView(view, settings, "1", 1)).rejects.toThrow("View changed");
  expect(api.patch).toHaveBeenCalledTimes(2);
});
it.each([
  { name: " " },
  { name: "x".repeat(81) },
  { layout: "grid" },
  { filters: { arbitrary: true } },
  { filters: { cycleIds: ["invalid"] } },
  { filters: { assigneeUserIds: Array(51).fill("1") } },
  { sorts: Array(4).fill({ field: "title", direction: "asc" }) },
  { visibleFields: ["custom:invalid"] },
])("rejects invalid edits %j before writes", async (change) => {
  const view = snapshot();
  const bad = { ...settingsOf(view), ...change };
  expect(viewSettings.safeParse(bad).success).toBe(false);
  await expect(saveTaskView(view, bad as ReturnType<typeof settingsOf>, "1", 1)).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
