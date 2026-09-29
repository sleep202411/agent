import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskAssignments,
  updateTaskAssignments,
  parseTaskReward,
  taskRewardText,
} from "./task-assignment-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const detail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Render",
  submissions: [],
  version: 1,
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  status: "submitted",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
};
const snapshot = {
  ...detail,
  assignees: [{ id, userId: "1", currency: "USD" as const, rewardAmountMinor: 12345 }],
};
beforeEach(() => vi.resetAllMocks());
it("parses exact minor units without rounding and preserves empty rewards", () => {
  expect(parseTaskReward("")).toBeNull();
  expect(parseTaskReward("123.45")).toBe(12345);
  expect(parseTaskReward("0.01")).toBe(1);
  expect(parseTaskReward("100000000.00")).toBe(10000000000);
  expect(taskRewardText(12345)).toBe("123.45");
  expect(taskRewardText(null)).toBe("");
  for (const value of ["0", "-1", "1.001", "1e2", "NaN", "100000000.01", "01", "1,000"])
    expect(() => parseTaskReward(value)).toThrow();
});
it("requires complete reward data and the exact opening version", async () => {
  vi.mocked(api.get).mockResolvedValue(snapshot);
  const signal = new AbortController().signal;
  expect(await fetchTaskAssignments(detail, signal)).toEqual(snapshot);
  for (const change of [
    { version: 2 },
    { crewId: "other" },
    { assignees: [{ id, userId: "1" }] },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, ...change });
    await expect(fetchTaskAssignments(detail, signal)).rejects.toThrow();
  }
});
it("preserves retained rewards and adds unpaid assignments using a versioned write", async () => {
  const data = {
    expectedVersion: 1,
    assignees: [
      { userId: "1", currency: "USD" as const, rewardAmountMinor: 12345 },
      { userId: "2", currency: "CNY" as const, rewardAmountMinor: null },
    ],
  };
  vi.mocked(api.patch).mockResolvedValue({
    ...snapshot,
    version: 2,
    assignees: data.assignees.map((a) => ({ id, ...a })),
  });
  await updateTaskAssignments(snapshot, data);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data,
  });
});
it("rejects malformed assignments and mismatched acknowledgements", async () => {
  await expect(
    updateTaskAssignments(snapshot, {
      expectedVersion: 1,
      assignees: [{ userId: "1", currency: "USD", rewardAmountMinor: 0 }],
    })
  ).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
  for (const change of [
    { version: 1 },
    { crewId: "other" },
    { assignees: [] },
    { assignees: [{ ...snapshot.assignees[0], rewardAmountMinor: null }] },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2, ...change });
    await expect(
      updateTaskAssignments(snapshot, {
        expectedVersion: 1,
        assignees: [{ userId: "1", currency: "USD", rewardAmountMinor: 12345 }],
      })
    ).rejects.toThrow("acknowledgement");
  }
});
it("does not retry a recruitment or commitment rejection", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Contract assignment is locked"));
  await expect(
    updateTaskAssignments(snapshot, { expectedVersion: 1, assignees: [] })
  ).rejects.toThrow("Contract assignment is locked");
  expect(api.patch).toHaveBeenCalledOnce();
});
