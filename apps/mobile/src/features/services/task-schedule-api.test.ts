import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  parseScheduleDate,
  scheduleDateText,
  taskScheduleInput,
  updateTaskSchedule,
} from "./task-schedule-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
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
beforeEach(() => vi.resetAllMocks());
it("parses local dates strictly and rejects normalized invalid calendar/time values", () => {
  expect(parseScheduleDate("2026-10-01 12:30", null)).toBe(
    new Date(2026, 9, 1, 12, 30).toISOString()
  );
  for (const value of [
    "2026-02-30 12:00",
    "2026-13-01 12:00",
    "2026-10-01 24:00",
    "2026-10-01 12:60",
    "tomorrow",
  ])
    expect(() => parseScheduleDate(value, null)).toThrow();
  expect(parseScheduleDate("2024-02-29 12:00", null)).toBe(new Date(2024, 1, 29, 12).toISOString());
});
it("preserves unchanged sub-minute precision and distinguishes removal from unchanged", () => {
  const original = "2026-10-01T12:30:45.123+08:00";
  expect(parseScheduleDate(scheduleDateText(original), original)).toBe(original);
  expect(parseScheduleDate("", original)).toBeNull();
  expect(scheduleDateText(null)).toBe("");
  expect(parseScheduleDate("", null)).toBeNull();
});
it("validates ordering while allowing equal dates and either unset endpoint", () => {
  const input = {
    expectedVersion: 1,
    priority: "normal" as const,
    startAt: "2026-10-01T00:00:00Z",
    dueAt: "2026-10-01T00:00:00Z",
  };
  expect(taskScheduleInput.parse(input)).toEqual(input);
  expect(() => taskScheduleInput.parse({ ...input, dueAt: "2026-09-30T23:59:59Z" })).toThrow();
  expect(taskScheduleInput.parse({ ...input, startAt: null }).startAt).toBeNull();
  expect(taskScheduleInput.parse({ ...input, dueAt: null }).dueAt).toBeNull();
});
it("sends the captured version and accepts equivalent returned date offsets", async () => {
  const input = {
    expectedVersion: 1,
    priority: "urgent" as const,
    startAt: null,
    dueAt: "2026-10-01T08:00:00+08:00",
  };
  vi.mocked(api.patch).mockResolvedValue({
    ...detail,
    version: 2,
    priority: "urgent",
    dueAt: "2026-10-01T00:00:00.000Z",
  });
  await updateTaskSchedule(detail, input);
  expect(api.patch).toHaveBeenCalledWith(`/crew-tasks/${id}`, { service: "aurora", data: input });
  for (const change of [
    { crewId: "other" },
    { version: 1 },
    { priority: "normal" },
    { dueAt: null },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({
      ...detail,
      version: 2,
      priority: "urgent",
      ...change,
    });
    await expect(updateTaskSchedule(detail, input)).rejects.toThrow("acknowledgement mismatch");
  }
});
it("does not send reversed dates or retry concurrency conflicts", async () => {
  const input = {
    expectedVersion: 1,
    priority: "normal" as const,
    startAt: "2026-10-02T00:00:00Z",
    dueAt: "2026-10-01T00:00:00Z",
  };
  await expect(updateTaskSchedule(detail, input)).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
  vi.mocked(api.patch).mockRejectedValue(new Error("Task version changed"));
  await expect(updateTaskSchedule(detail, { ...input, dueAt: null })).rejects.toThrow(
    "Task version changed"
  );
  expect(api.patch).toHaveBeenCalledOnce();
});
