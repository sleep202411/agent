import { expect, it } from "vitest";
import { batchAssignment, batchRecruitment, canBatchTask } from "./workbench-batch-input";
import type { CrewTaskListItemDTO } from "@/app/(site)/crews/_hooks/types";
const task = {
  id: "task",
  version: 8,
  title: "Edit",
  description: "Edit film",
  status: "open",
  assignees: [],
  rewardCurrency: "CNY",
  rewardUsdMinor: 12500,
  paymentTerms: "fixed",
  profitShareBps: 250,
} as unknown as CrewTaskListItemDTO;
it("keeps regional compensation and optimistic concurrency when assigning", () => {
  expect(batchAssignment(task, "member")).toEqual({
    expectedVersion: 8,
    assignees: [{ userId: "member", currency: "CNY", rewardAmountMinor: 12500 }],
  });
});
it("publishes each task with its own compensation and profit share", () => {
  expect(batchRecruitment(task, "editor")).toMatchObject({
    taskId: "task",
    recruitmentVisibility: "public",
    targetCount: 1,
    revenueSharePercent: 2.5,
    salary: { currency: "CNY", min: 125, max: 125, period: "project" },
  });
});
it.each(["approved", "submitted", "cancelled"])("does not batch %s work", (status) => {
  expect(canBatchTask({ ...task, status } as CrewTaskListItemDTO)).toBe(false);
});
it("excludes assignments and existing recruitment", () => {
  expect(canBatchTask(task)).toBe(true);
  expect(canBatchTask({ ...task, isRecruiting: true })).toBe(false);
  expect(canBatchTask({ ...task, assignees: [{ userId: "member" }] } as CrewTaskListItemDTO)).toBe(
    false
  );
});
