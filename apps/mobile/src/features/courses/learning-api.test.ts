import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { learningApi } from "./learning-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  courseId: "21",
  studentId: "1",
  teacherId: "2",
  version: 1,
  priceCredits: "1000",
  teacherCredits: "500",
  status: "enrolled",
  description: null,
  assetIds: [],
  score: null,
  feedback: null,
  badgeIssuedAt: null,
  createdAt: "2026-10-07T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("uses the regional Aurora service and optimistic enrollment version without retrying payment", async () => {
  vi.mocked(api.post).mockResolvedValue(row);
  const signal = new AbortController().signal;
  expect(await learningApi.enroll("21", 3, signal)).toMatchObject({ priceCredits: "1000" });
  expect(api.post).toHaveBeenCalledWith("/academy/learning/courses/21/enroll", {
    service: "aurora",
    signal,
    retry: false,
    data: { expectedVersion: 3 },
  });
});
it("rejects malformed course results rather than displaying fabricated prices", async () => {
  vi.mocked(api.get).mockResolvedValue({
    offering: { version: 1, enabled: true, priceCredits: -5 },
    enrollment: null,
  });
  await expect(learningApi.course("21", new AbortController().signal)).rejects.toThrow();
});
it("validates homework and reviews before issuing a mutation", async () => {
  expect(() =>
    learningApi.submit(
      id,
      { expectedVersion: 1, description: "work", assetIds: [id, id] },
      new AbortController().signal
    )
  ).toThrow();
  expect(() =>
    learningApi.review(
      id,
      { expectedVersion: 1, decision: "approved", score: 101, feedback: "yes" },
      new AbortController().signal
    )
  ).toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("discards responses belonging to an old account", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return { courses: 1, students: 2, pending: 1, earnedCredits: "500" };
  });
  await expect(learningApi.summary(new AbortController().signal)).rejects.toThrow(
    "account changed"
  );
});
it("does not send cancelled mutations", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(learningApi.enroll("21", 1, controller.signal)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("forwards cursor and rejects unsafe private attachment URLs", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: [row], nextCursor: null })
    .mockResolvedValueOnce({ url: "javascript:alert(1)" });
  const signal = new AbortController().signal;
  expect((await learningApi.teaching(id, signal)).items).toHaveLength(1);
  expect(api.get).toHaveBeenCalledWith(
    `/academy/learning/teaching?after=${id}`,
    expect.objectContaining({ service: "aurora" })
  );
  await expect(learningApi.attachment(id, id, signal)).rejects.toThrow();
});

it("retains the server's co-instructor access decision", async () => {
  vi.mocked(api.get).mockResolvedValue({ offering: null, enrollment: null, instructor: true });
  expect(await learningApi.course("21", new AbortController().signal)).toMatchObject({
    instructor: true,
  });
});
