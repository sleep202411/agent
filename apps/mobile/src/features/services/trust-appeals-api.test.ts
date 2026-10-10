import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTrustAppeals, reviewTrustAppeal } from "./trust-appeals-api";
import { fetchTaskCommentAccess } from "./task-comment-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001",
  correction = "00000000-0000-4000-8000-000000000002",
  signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(fetchTaskCommentAccess).mockResolvedValue({
    allowed: true,
    canInvite: false,
    canManage: true,
  });
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(api.post).mockResolvedValue({ id, status: "corrected", correctionId: correction });
});
it("uses history/cursor and fresh task-management authorization", async () => {
  await fetchTrustAppeals("crew", "user", 1, true, id, signal);
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/trust-appeals",
    expect.objectContaining({ params: { status: "all", cursor: id }, signal, retry: false })
  );
});
it("denies reads and writes without tasks.manage", async () => {
  vi.mocked(fetchTaskCommentAccess).mockResolvedValue({
    allowed: true,
    canInvite: false,
    canManage: false,
  });
  await expect(fetchTrustAppeals("crew", "user", 1, false, null, signal)).rejects.toThrow(
    "permission"
  );
  await expect(
    reviewTrustAppeal(
      "crew",
      "user",
      1,
      id,
      { decision: "upheld", reason: "evidence", expectedCorrectionId: null },
      signal
    )
  ).rejects.toThrow("permission");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("sends correction snapshot and only official point values", async () => {
  await reviewTrustAppeal(
    "crew",
    "user",
    1,
    id,
    { decision: "corrected", points: -200, reason: " evidence ", expectedCorrectionId: correction },
    signal
  );
  expect(api.post).toHaveBeenCalledWith(
    `/crews/crew/trust-appeals/${id}/review`,
    expect.objectContaining({
      data: {
        decision: "corrected",
        points: -200,
        reason: "evidence",
        expectedCorrectionId: correction,
      },
      retry: false,
    })
  );
});
it("does not send points when upholding", async () => {
  vi.mocked(api.post).mockResolvedValue({ id, status: "upheld", correctionId: null });
  await reviewTrustAppeal(
    "crew",
    "user",
    1,
    id,
    { decision: "upheld", reason: "valid", expectedCorrectionId: null },
    signal
  );
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toEqual({
    decision: "upheld",
    reason: "valid",
    expectedCorrectionId: null,
  });
});
it("rejects a mismatched mutation receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({
    id: correction,
    status: "corrected",
    correctionId: correction,
  });
  await expect(
    reviewTrustAppeal(
      "crew",
      "user",
      1,
      id,
      { decision: "corrected", points: 200, reason: "valid", expectedCorrectionId: null },
      signal
    )
  ).rejects.toThrow("receipt");
});
it("blocks account changes during authorization before writing", async () => {
  vi.mocked(fetchTaskCommentAccess).mockImplementation(async () => {
    h.generation = 2;
    return { allowed: true, canInvite: false, canManage: true };
  });
  await expect(
    reviewTrustAppeal(
      "crew",
      "user",
      1,
      id,
      { decision: "upheld", reason: "valid", expectedCorrectionId: null },
      signal
    )
  ).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
});
