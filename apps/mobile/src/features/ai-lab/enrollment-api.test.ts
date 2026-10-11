import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  completeEnrollment,
  enrollmentErrorCode,
  enrollmentOrigin,
  loadEnrollmentStatus,
  startEnrollment,
} from "./enrollment-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      public code: string | number,
      message: string,
      public status: number,
      public responseBody?: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: vi.fn(),
  canCreateStudioProject: vi.fn(),
}));
const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  characterId: "22222222-2222-4222-8222-222222222222",
  generation: 1,
};
const detail = {
  id: scope.characterId,
  workspaceId: scope.workspaceId,
  kind: "real_person",
  name: "Me",
  description: null,
  status: "draft",
  coverAssetId: null,
  createdByUserId: "actor",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mediaCounts: { image: 0, video: 0, audio: 0 },
  media: [],
};
const session = () => ({
  sessionId: "33333333-3333-4333-8333-333333333333",
  h5Link: "https://verify.example/flow?capability=private",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(detail);
  h.post.mockResolvedValue(session());
});
it("starts a fresh selected likeness without app tokens in the payload or retries", async () => {
  const s = signal();
  expect((await startEnrollment(scope, s)).h5Link).toBe(session().h5Link);
  expect(h.get).toHaveBeenCalledWith(`/characters/${scope.characterId}`, {
    service: "aurora",
    signal: s,
    retry: false,
  });
  expect(h.post).toHaveBeenCalledExactlyOnceWith(
    `/characters/${scope.characterId}/enrollment/session`,
    { service: "aurora", signal: s, retry: false }
  );
});
it("rejects foreign, virtual and verified/revoked/disabled characters before starting", async () => {
  for (const patch of [
    { workspaceId: scope.characterId },
    { id: scope.workspaceId },
    { kind: "virtual" },
    { status: "active" },
    { status: "revoked" },
    { status: "disabled" },
  ]) {
    h.get.mockResolvedValueOnce({ ...detail, ...patch });
    await expect(startEnrollment(scope, signal())).rejects.toThrow();
  }
  expect(h.post).not.toHaveBeenCalled();
});
it("checks an uncertain start without creating or completing another session or recovering its URL", async () => {
  const error = new Error("Connection interrupted");
  h.post.mockRejectedValueOnce(error);
  await expect(startEnrollment(scope, signal())).rejects.toBe(error);
  h.get.mockResolvedValueOnce({
    sessionStatus: "pending",
    characterStatus: "pending_verification",
    expiresAt: session().expiresAt,
    h5Link: "must-not-be-recovered",
  });
  const result = await loadEnrollmentStatus(scope, signal());
  expect(result.sessionStatus).toBe("pending");
  expect(result).not.toHaveProperty("h5Link");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("requires credential-free HTTPS and unexpired session receipts", async () => {
  for (const h5Link of [
    "http://verify.example/flow",
    "javascript:alert(1)",
    "https://user:secret@verify.example",
    "//verify.example",
  ]) {
    h.post.mockResolvedValueOnce({ ...session(), h5Link });
    await expect(startEnrollment(scope, signal())).rejects.toThrow(
      "Invalid verification session URL"
    );
  }
  h.post.mockResolvedValueOnce({ ...session(), expiresAt: "2020-01-01T00:00:00Z" });
  await expect(startEnrollment(scope, signal())).rejects.toThrow("expired");
  expect(enrollmentOrigin(session().h5Link)).toBe("https://verify.example");
});
it("uses only the server receipt, no callback token or optimistic activation", async () => {
  h.post.mockResolvedValueOnce({ ...detail, status: "active" });
  const s = signal();
  expect((await completeEnrollment(scope, s)).status).toBe("active");
  expect(h.post).toHaveBeenCalledExactlyOnceWith(
    `/characters/${scope.characterId}/enrollment/complete`,
    { service: "aurora", signal: s, retry: false }
  );
  h.post.mockResolvedValueOnce(detail);
  expect((await completeEnrollment(scope, signal())).status).toBe("draft");
  for (const patch of [
    { id: scope.workspaceId },
    { workspaceId: scope.characterId },
    { kind: "virtual" },
  ]) {
    h.post.mockResolvedValueOnce({ ...detail, ...patch });
    await expect(completeEnrollment(scope, signal())).rejects.toThrow("receipt");
  }
});
it("preserves not-completed, expired, rate-limit and provider errors", async () => {
  for (const code of [
    "ENROLLMENT_NOT_COMPLETED",
    "ENROLLMENT_SESSION_EXPIRED",
    "ACR_ENROLLMENT_PAUSED",
  ]) {
    const e = new ApiRequestError("HTTP_409", "Provider detail", 409, JSON.stringify({ code }));
    h.post.mockRejectedValueOnce(e);
    await expect(completeEnrollment(scope, signal())).rejects.toBe(e);
    expect(enrollmentErrorCode(e)).toBe(code);
  }
  expect(enrollmentErrorCode(new ApiRequestError("RATE_LIMITED", "Slow down", 429))).toBe(
    "RATE_LIMITED"
  );
  expect(
    enrollmentErrorCode(new ApiRequestError("HTTP_500", "Failure", 500, "invalid"))
  ).toBeNull();
  expect(enrollmentErrorCode(new Error("ENROLLMENT_NOT_COMPLETED"))).toBeNull();
});
it("discards late account results and makes no calls from an aborted scope", async () => {
  for (const action of [startEnrollment, completeEnrollment, loadEnrollmentStatus]) {
    const controller = new AbortController();
    controller.abort();
    await expect(action(scope, controller.signal)).rejects.toThrow("expired");
  }
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return session();
  });
  await expect(startEnrollment(scope, signal())).rejects.toThrow("expired");
  h.generation = 1;
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return { ...detail, status: "active" };
  });
  await expect(completeEnrollment(scope, signal())).rejects.toThrow("expired");
  h.generation = 1;
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return { sessionStatus: "completed", characterStatus: "active" };
  });
  await expect(loadEnrollmentStatus(scope, signal())).rejects.toThrow("expired");
});
