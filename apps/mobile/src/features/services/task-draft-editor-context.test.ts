import { beforeEach, expect, it, vi } from "vitest";
import { restoreTaskDraftEditor } from "./task-draft-editor-context";
import type { TaskDraft } from "./task-draft-session";
const h = vi.hoisted(() => ({ planning: vi.fn(), workflows: vi.fn(), tasks: vi.fn() }));
vi.mock("./task-planning-api", () => ({ fetchTaskPlanningOptions: h.planning }));
vi.mock("./task-workflow-api", () => ({ fetchManualTaskWorkflows: h.workflows }));
vi.mock("./task-options", () => ({ fetchTaskOptions: h.tasks }));
const draft = {
  id: 1,
  kind: "task",
  state: "staged",
  input: {
    title: "Draft",
    description: "",
    priority: "normal",
    startAt: null,
    dueAt: null,
    parentId: "parent",
    blockedByTaskIds: ["blocker"],
    assignees: [{ userId: "user", currency: "USD" }],
    labelIds: ["label"],
    cycleId: "cycle",
    episodeId: "episode",
    workflowStateId: "workflow",
  },
  review: { context: [], assignees: ["Alice"], customFields: [] },
} as Extract<TaskDraft, { kind: "task" }>;
beforeEach(() => {
  vi.resetAllMocks();
  h.planning.mockImplementation((_crew, kind) => [
    { id: kind === "labels" ? "label" : kind, name: kind },
  ]);
  h.workflows.mockResolvedValue([{ id: "workflow", name: "Doing" }]);
  h.tasks
    .mockResolvedValueOnce({
      items: [{ id: "parent", number: 1, title: "Parent" }],
      nextCursor: "page2",
    })
    .mockResolvedValue({
      items: [{ id: "blocker", number: 2, title: "Blocker" }],
      nextCursor: null,
    });
});
it("restores all saved selections including dependencies on later pages", async () => {
  const editor = await restoreTaskDraftEditor("crew", draft, new AbortController().signal);
  expect(editor.planning).toEqual({
    labels: [{ id: "label", name: "labels" }],
    cycle: { id: "cycle", name: "cycle" },
    episode: { id: "episode", name: "episode" },
  });
  expect(editor.parent?.id).toBe("parent");
  expect(editor.blockers.map((t) => t.id)).toEqual(["blocker"]);
  expect(editor.workflow?.id).toBe("workflow");
  expect(editor.assignees).toEqual([{ userId: "user", label: "Alice" }]);
  expect(h.tasks.mock.calls[1][2]).toBe("page2");
  expect(draft.review.editor).toBeUndefined();
});
it("fails without changing the draft when a saved selection is unavailable", async () => {
  h.planning.mockResolvedValue([]);
  await expect(restoreTaskDraftEditor("crew", draft, new AbortController().signal)).rejects.toThrow(
    "draft has not been changed"
  );
  expect(draft.input.labelIds).toEqual(["label"]);
});
it("rejects a pagination loop rather than dropping dependencies", async () => {
  h.tasks.mockReset().mockResolvedValue({ items: [], nextCursor: "same" });
  await expect(restoreTaskDraftEditor("crew", draft, new AbortController().signal)).rejects.toThrow(
    "pagination"
  );
  expect(h.tasks).toHaveBeenCalledTimes(2);
});
it("does not replace explicit cleared metadata or fetch unnecessary options", async () => {
  const editor = {
    planning: { labels: [], cycle: null, episode: null },
    workflow: null,
    parent: null,
    blockers: [],
    assignees: [],
  };
  expect(
    await restoreTaskDraftEditor(
      "crew",
      { ...draft, review: { ...draft.review, editor } },
      new AbortController().signal
    )
  ).toBe(editor);
  expect(h.planning).not.toHaveBeenCalled();
  expect(h.tasks).not.toHaveBeenCalled();
});
it("abandons aborted restoration", async () => {
  const controller = new AbortController();
  h.planning.mockImplementation(async () => {
    controller.abort();
    return [];
  });
  await expect(restoreTaskDraftEditor("crew", draft, controller.signal)).rejects.toThrow();
  expect(h.tasks).not.toHaveBeenCalled();
});
