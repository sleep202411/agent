import { expect, it } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/types";
import { assetTaskProgress } from "./asset-task-progress";
const task = (id: string, status: string, extra = {}) =>
  ({ id, status, parentId: null, assetCategory: "characters", ...extra }) as CrewTaskDTO;
it("counts approved deliverables, excluding pending reviews, containers, cancellations and duplicate pages", () => {
  const rows = [
    task("group", "approved"),
    task("a", "approved", { parentId: "group" }),
    task("b", "submitted"),
    task("c", "in_progress"),
    task("d", "cancelled"),
    task("a", "approved", { parentId: "group" }),
  ];
  expect(assetTaskProgress(rows).characters).toEqual({ approved: 1, total: 3 });
});
it("does not infer category from localized titles or count missing categories as characters", () => {
  expect(
    assetTaskProgress([task("a", "approved", { assetCategory: undefined, title: "Characters" })])
      .other
  ).toEqual({ approved: 1, total: 1 });
  expect(assetTaskProgress([]).characters).toEqual({ approved: 0, total: 0 });
});

it("inherits an explicit category for subtasks without counting the parent twice", () => {
  expect(
    assetTaskProgress([
      task("parent", "approved"),
      task("child", "approved", { parentId: "parent", assetCategory: "other" }),
    ]).characters
  ).toEqual({ approved: 1, total: 1 });
});

it("displays Pax's 12 approved out of 24 task example", () => {
  const tasks = Array.from({ length: 24 }, (_, i) =>
    task(String(i), i < 12 ? "approved" : "submitted")
  );
  expect(assetTaskProgress(tasks).characters).toEqual({ approved: 12, total: 24 });
});
