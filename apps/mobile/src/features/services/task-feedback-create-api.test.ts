import { beforeEach, expect, it, vi } from "vitest";
import {
  createTaskFeedback,
  feedbackTarget,
  type FeedbackCreation,
} from "./task-feedback-create-api";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), detail: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = {
  id: id(1),
  crewId: "crew",
  status: "approved",
  submissions: [
    {
      id: id(2),
      versionNumber: 2,
      submittedByUserId: "creator",
      reviewedByUserId: "reviewer",
      reviewedAt: "2026-10-01T00:00:00Z",
    },
  ],
} as TaskDetail;
const input: FeedbackCreation = {
  clientKey: id(3),
  submissionId: id(2),
  subjectUserId: "reviewer",
  ratings: { direction: "manager", managementAbility: 4 },
  comment: "Good communication",
};
const row = {
  id: id(4),
  taskId: id(1),
  submissionId: id(2),
  authorUserId: "creator",
  subjectUserId: "reviewer",
  ratings: input.ratings,
  comment: input.comment,
  createdAt: "2026-10-01T00:00:00Z",
  response: null,
  respondedAt: null,
};
const send = (value = input, signal = new AbortController().signal) =>
  createTaskFeedback("crew", id(1), "creator", 1, value, signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(task);
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  h.post.mockResolvedValue(row);
});
it("only pairs actual creator/reviewer of the latest approved submission", () => {
  expect(feedbackTarget(task, "creator")?.direction).toBe("manager");
  expect(feedbackTarget(task, "reviewer")?.direction).toBe("creator");
  expect(feedbackTarget(task, "admin")).toBeNull();
  expect(feedbackTarget({ ...task, status: "submitted" }, "creator")).toBeNull();
  expect(
    feedbackTarget(
      {
        ...task,
        submissions: [
          ...task.submissions,
          { ...task.submissions[0]!, versionNumber: 3, reviewedAt: null },
        ],
      },
      "creator"
    )
  ).toBeNull();
  expect(
    feedbackTarget(
      { ...task, submissions: [{ ...task.submissions[0]!, reviewedByUserId: "creator" }] },
      "creator"
    )
  ).toBeNull();
});
it("sends the official payload with no automatic retry and validates the receipt", async () => {
  await send();
  expect(h.post).toHaveBeenCalledWith(
    `/crew-tasks/${id(1)}/feedback`,
    expect.objectContaining({
      retry: false,
      data: {
        subjectUserId: input.subjectUserId,
        ratings: input.ratings,
        comment: input.comment,
        publicOnProfile: false,
      },
    })
  );
  h.post.mockResolvedValue({ ...row, submissionId: id(7) });
  await expect(send()).rejects.toThrow("receipt");
});
it("recovers a recorded result through personal history without resending or requiring current membership", async () => {
  h.get
    .mockResolvedValueOnce({ items: [], nextCursor: id(8) })
    .mockResolvedValueOnce({ items: [row], nextCursor: null });
  await expect(send()).resolves.toEqual(row);
  expect(h.post).not.toHaveBeenCalled();
  expect(h.detail).not.toHaveBeenCalled();
});
it("rejects a changed rating after an earlier submission", async () => {
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await expect(send({ ...input, comment: "Different comment" })).rejects.toThrow(
    "Different feedback"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("rechecks approval, submission identity and participants before writing", async () => {
  h.detail.mockResolvedValue({ ...task, status: "submitted" });
  await expect(send()).rejects.toThrow("changed");
  h.detail.mockResolvedValue(task);
  await expect(send({ ...input, submissionId: id(9) })).rejects.toThrow("changed");
  await expect(
    send({
      ...input,
      ratings: { direction: "creator", productionAbility: 3, understanding: 3, communication: 3 },
    })
  ).rejects.toThrow("changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects expired sessions, aborted operations, invalid scores and pagination cycles", async () => {
  h.generation = 2;
  await expect(send()).rejects.toThrow("expired");
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(send(input, c.signal)).rejects.toThrow("expired");
  await expect(
    send({ ...input, ratings: { direction: "manager", managementAbility: 0 } })
  ).rejects.toThrow();
  h.get.mockResolvedValue({ items: [], nextCursor: id(8) });
  await expect(send()).rejects.toThrow("pagination");
  expect(h.post).not.toHaveBeenCalled();
});

it("publishes new reviews with optional comments and checks visibility on receipt", async () => {
  const request = { ...input, comment: "", publicOnProfile: true };
  h.post.mockResolvedValue({ ...row, comment: "", publicOnProfile: true });
  await send(request);
  expect(h.post).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      data: expect.objectContaining({ comment: "", publicOnProfile: true }),
    })
  );
  h.post.mockResolvedValue({ ...row, comment: "", publicOnProfile: false });
  await expect(send(request)).rejects.toThrow("receipt");
});
it("never upgrades a saved private review on retry or accepts a different visibility", async () => {
  h.get.mockResolvedValue({ items: [{ ...row, publicOnProfile: false }], nextCursor: null });
  await send(input);
  expect(h.post).not.toHaveBeenCalled();
  await expect(send({ ...input, publicOnProfile: true })).rejects.toThrow("Different feedback");
  expect(h.post).not.toHaveBeenCalled();
});
