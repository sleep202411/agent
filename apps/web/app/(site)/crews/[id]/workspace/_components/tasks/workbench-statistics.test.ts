import { expect, it } from "vitest";
import { workbenchStatistics } from "./workbench-statistics";
it("counts deliverables once and excludes completed/cancelled tasks from overdue", () => {
  const task = {
    id: "a",
    parentId: "group",
    status: "in_progress" as const,
    dueAt: "2026-10-01T00:00:00Z",
  };
  expect(
    workbenchStatistics(
      [
        { ...task, id: "group", parentId: null },
        task,
        task,
        { ...task, id: "b", status: "approved" },
        { ...task, id: "c", status: "cancelled" },
        { ...task, id: "d", status: "open", dueAt: "invalid" },
        { ...task, id: "e", status: "submitted", dueAt: "2026-11-01T00:00:00Z" },
      ],
      Date.parse("2026-10-09T00:00:00Z")
    )
  ).toEqual({ total: 4, inProgress: 2, overdue: 1, completed: 1 });
});
