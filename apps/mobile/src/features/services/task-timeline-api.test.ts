import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskTimeline,
  taskActivityLabel,
  taskActivityNote,
  type TaskActivity,
} from "./task-timeline-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const item: TaskActivity = {
  id,
  taskId: id,
  kind: "comment",
  version: 1,
  mentions: [],
  actorUserId: "1",
  body: "Note",
  createdAt: "2026-09-29T00:00:00Z",
  editedAt: null,
  deletedAt: null,
  replyTo: null,
  attachments: [],
  payload: {},
};
beforeEach(() => vi.resetAllMocks());
it("uses the authorized paginated timeline contract and validates task scope", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [item], nextCursor: null });
  const signal = new AbortController().signal;
  expect((await fetchTaskTimeline(id, id, signal)).items).toEqual([item]);
  expect(api.get).toHaveBeenCalledWith(`/crew-tasks/${id}/timeline`, {
    service: "aurora",
    signal,
    params: { limit: 30, cursor: id },
  });
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...item, taskId: "22222222-2222-4222-8222-222222222222" }],
    nextCursor: null,
  });
  await expect(fetchTaskTimeline(id, null, signal)).rejects.toThrow("scope mismatch");
});
it("rejects invalid cursors before requesting", async () => {
  await expect(fetchTaskTimeline(id, "bad", new AbortController().signal)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});
it("maps known activity, tolerates unknown kinds and renders only intended notes", () => {
  expect(taskActivityLabel("task.approved")).toBe("taskActivity.approved");
  expect(taskActivityLabel("__proto__")).toBe("taskActivity.changed");
  expect(
    taskActivityNote({ ...item, kind: "task.approved", payload: { note: "Approved note" } })
  ).toBe("Approved note");
  expect(
    taskActivityNote({
      ...item,
      kind: "task.updated",
      payload: {
        closureOutcome: "cancelled_without_financial_settlement",
        closure: { reason: "Cancelled" },
      },
    })
  ).toBe("Cancelled");
  expect(taskActivityNote({ ...item, payload: { note: "Hidden" } })).toBeNull();
  expect(
    taskActivityNote({
      ...item,
      kind: "task.approved",
      deletedAt: item.createdAt,
      payload: { note: "Hidden" },
    })
  ).toBeNull();
});
