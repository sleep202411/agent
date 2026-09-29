import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskReviewPermission,
  revisionDeadline,
  reviewTask,
  primaryVideo,
} from "./task-review-api";
import type { TaskDetail } from "./task-detail-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const submission = {
  id,
  versionNumber: 1,
  submittedByUserId: "1",
  note: "",
  professionalDelivery: null,
  canvasVersionId: null,
  productionVersionId: null,
  reviewNote: "Approved",
  reviewedByUserId: "2",
  reviewedAt: "2026-09-29T00:00:00Z",
  mergedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  assets: [],
};
const task: TaskDetail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "",
  version: 2,
  status: "approved",
  revisionLimit: 2,
  revisionRoundsUsed: 0,
  workflowState: { name: "Approved" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [],
  submissions: [submission],
};
beforeEach(() => vi.resetAllMocks());
it("uses explicit reviewer permission and rejects another account's membership", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.manage"] });
  const signal = new AbortController().signal;
  expect(await fetchTaskReviewPermission("crew", "1", signal)).toBe(false);
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.review"] });
  expect(await fetchTaskReviewPermission("crew", "1", signal)).toBe(true);
  await expect(fetchTaskReviewPermission("crew", "2", signal)).rejects.toThrow("account mismatch");
});
it("validates local calendar/time and only extends future deadlines", () => {
  const now = new Date(2026, 8, 29, 12).getTime(),
    due = new Date(2026, 8, 30, 12).toISOString();
  expect(revisionDeadline("2026-10-01 12:30", due, now)).toBe(
    new Date(2026, 9, 1, 12, 30).toISOString()
  );
  expect(revisionDeadline("", due, now)).toBeUndefined();
  for (const value of [
    "2026-02-30 12:00",
    "2026-10-01 25:00",
    "2026-09-30 12:00",
    "2026-09-28 12:00",
    "tomorrow",
  ])
    expect(() => revisionDeadline(value, due, now)).toThrow();
});
it("sends the exact submission identity and validates the returned review", async () => {
  vi.mocked(api.post).mockResolvedValue(task);
  const input = { expectedSubmissionId: id, decision: "approve" as const, note: " Approved " };
  await reviewTask(id, "crew", input);
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/review`, {
    service: "aurora",
    data: { ...input, note: "Approved" },
  });
  for (const result of [
    { ...task, crewId: "other" },
    { ...task, status: "submitted" },
    { ...task, submissions: [] },
  ]) {
    vi.mocked(api.post).mockResolvedValue(result);
    await expect(reviewTask(id, "crew", input)).rejects.toThrow("acknowledgement mismatch");
  }
  await expect(
    reviewTask(id, "crew", { ...input, decision: "request_revision", note: " " })
  ).rejects.toThrow();
  await expect(
    reviewTask(id, "crew", { ...input, revisionDueAt: "2026-10-01T00:00:00Z" })
  ).rejects.toThrow();
});
it("selects only submitted video assets, preferring the professional final-video slot", () => {
  const assets = [
    { id: "first", name: "A", mediaAssetId: null, contentType: "video/mp4", sizeBytes: null },
    { id: "second", name: "B", mediaAssetId: null, contentType: "video/mp4", sizeBytes: null },
  ];
  expect(primaryVideo({ ...task, submissions: [{ ...submission, assets }] })).toBe("first");
  expect(
    primaryVideo({
      ...task,
      submissions: [
        {
          ...submission,
          assets,
          professionalDelivery: {
            categoryId: id,
            version: 1,
            definition: { name: "Video", description: "", fields: [], prices: [] },
            answers: { final_video: ["second"] },
          },
        },
      ],
    })
  ).toBe("second");
});
