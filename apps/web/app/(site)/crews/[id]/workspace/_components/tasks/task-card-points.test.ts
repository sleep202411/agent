import { describe, expect, it } from "vitest";
import { taskRequestedPoints } from "./task-card-points";
const row = (userId: string, requestedPoints?: string) => ({
  taskId: "task",
  taskTitle: "Script",
  userId,
  requestedPoints,
  approvedPoints: "1",
  pendingPoints: "2",
  consumedPoints: "3",
  committedPoints: "4",
});
const page = (taskUsage: unknown[], isOwner = true) => ({
  isOwner,
  consumedPoints: "3",
  totals: {},
  tasks: [],
  nextCursor: "more-requests",
  items: [],
  taskUsage,
});
describe("task card requested points", () => {
  it("uses complete aggregates across recipients, not the paginated records, without losing integer precision", () => {
    expect(
      taskRequestedPoints(page([row("a", "9007199254740993"), row("b", "7")]))?.byTask.get("task")
    ).toBe("9007199254741000");
  });
  it("keeps the member scope and zero distinct from missing fields", () => {
    expect(taskRequestedPoints(page([row("a", "0")], false))).toMatchObject({ isOwner: false });
    expect(taskRequestedPoints(page([row("a", "0")]))?.byTask.get("task")).toBe("0");
    expect(taskRequestedPoints(page([row("a", "10"), row("b")]))?.byTask.get("task")).toBeNull();
  });
  it("does not present malformed or unavailable data as a zero balance", () => {
    expect(taskRequestedPoints(undefined)).toBeNull();
    expect(taskRequestedPoints(page([row("a", "-1")]))).toBeNull();
    expect(taskRequestedPoints(page([row("a", "1.5")]))).toBeNull();
  });
});
