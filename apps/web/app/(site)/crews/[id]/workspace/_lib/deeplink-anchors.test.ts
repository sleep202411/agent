import { describe, expect, it } from "vitest";
import { workspaceDeeplinkAnchors } from "./deeplink-anchors";

const SUBMITTED = new URLSearchParams("tab=tasks&task=task_42");

describe("workspaceDeeplinkAnchors", () => {
  it("targets the task row named by the notification", () => {
    expect(workspaceDeeplinkAnchors("tasks", SUBMITTED)).toEqual(["task-row-task_42"]);
  });

  it.each(["overview", "roles", "members"] as const)(
    "targets nothing on the %s tab, which renders no such row",
    (tab) => {
      expect(workspaceDeeplinkAnchors(tab, SUBMITTED)).toEqual([]);
    }
  );

  it("targets nothing when the link carries no ids", () => {
    expect(workspaceDeeplinkAnchors("tasks", new URLSearchParams("tab=tasks"))).toEqual([]);
  });
});
