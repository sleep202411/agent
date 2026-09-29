import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskCommentPermission, postTaskComment } from "./task-comment-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const comment = {
  id,
  taskId: id,
  kind: "comment",
  actorUserId: "1",
  body: "Note",
  payload: {},
  deletedAt: null,
  editedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  replyTo: null,
  attachments: [],
};
beforeEach(() => vi.resetAllMocks());
it("uses explicit current-member permissions and rejects another account", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.view"] });
  expect(await fetchTaskCommentPermission("crew", "1", signal)).toBe(false);
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.comment"] });
  expect(await fetchTaskCommentPermission("crew", "1", signal)).toBe(true);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/members/me", { service: "aurora", signal });
  await expect(fetchTaskCommentPermission("crew", "2", signal)).rejects.toThrow("account mismatch");
});
it("validates bounded text and posts the supplied stable key, checking acknowledgement scope", async () => {
  vi.mocked(api.post).mockResolvedValue(comment);
  await postTaskComment(id, "1", { body: " Note ", clientKey: "same" });
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/comments`, {
    service: "aurora",
    data: { body: "Note", clientKey: "same" },
  });
  await expect(postTaskComment(id, "1", { body: " ", clientKey: "same" })).rejects.toThrow();
  await expect(
    postTaskComment(id, "1", { body: "x".repeat(10001), clientKey: "same" })
  ).rejects.toThrow();
  vi.mocked(api.post).mockResolvedValue({ ...comment, actorUserId: "2" });
  await expect(postTaskComment(id, "1", { body: "Note", clientKey: "same" })).rejects.toThrow(
    "acknowledgement mismatch"
  );
});

it("sends a validated reply target and rejects a different reply acknowledgement", async () => {
  const replyId = "22222222-2222-4222-8222-222222222222";
  vi.mocked(api.post).mockResolvedValue({
    ...comment,
    replyTo: { id: replyId, body: "Original", deleted: false },
  });
  await postTaskComment(id, "1", { body: "Reply", clientKey: "key", replyToId: replyId });
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/comments`, {
    service: "aurora",
    data: { body: "Reply", clientKey: "key", replyToId: replyId },
  });
  await expect(
    postTaskComment(id, "1", { body: "Reply", clientKey: "key", replyToId: "bad" })
  ).rejects.toThrow();
  vi.mocked(api.post).mockResolvedValue(comment);
  await expect(
    postTaskComment(id, "1", { body: "Reply", clientKey: "key", replyToId: replyId })
  ).rejects.toThrow("acknowledgement mismatch");
});
