import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskCommentAccess,
  postTaskComment,
  removeTaskComment,
  editTaskComment,
} from "./task-comment-api";
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));
const id = "11111111-1111-4111-8111-111111111111";
const comment = {
  id,
  taskId: id,
  kind: "comment",
  version: 1,
  mentions: [],
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
  expect(await fetchTaskCommentAccess("crew", "1", signal)).toEqual({
    allowed: false,
    canManage: false,
    canInvite: false,
  });
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.comment"] });
  expect(await fetchTaskCommentAccess("crew", "1", signal)).toEqual({
    allowed: true,
    canManage: false,
    canInvite: false,
  });
  expect(api.get).toHaveBeenCalledWith("/crews/crew/members/me", { service: "aurora", signal });
  await expect(fetchTaskCommentAccess("crew", "2", signal)).rejects.toThrow("account mismatch");
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

it("allows file-only comments while rejecting duplicate, excessive and malformed references", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...comment,
    attachments: [
      { id, name: "Clip", mediaAssetId: id, mediaKind: "video", contentType: "video/mp4" },
    ],
  });
  const attachment = { source: "asset" as const, assetNodeId: id };
  await postTaskComment(id, "1", { body: "", clientKey: "files", attachments: [attachment] });
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/comments`, {
    service: "aurora",
    data: { body: "", clientKey: "files", attachments: [attachment] },
  });
  for (const attachments of [
    [attachment, attachment],
    Array.from({ length: 11 }, () => attachment),
    [{ source: "asset" as const, assetNodeId: "invalid" }],
  ])
    await expect(
      postTaskComment(id, "1", { body: "", clientKey: "files", attachments })
    ).rejects.toThrow();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("rejects missing files in the comment acknowledgement", async () => {
  vi.mocked(api.post).mockResolvedValue(comment);
  await expect(
    postTaskComment(id, "1", {
      body: "",
      clientKey: "files",
      attachments: [{ source: "asset", assetNodeId: id }],
    })
  ).rejects.toThrow("acknowledgement mismatch");
});

it("accepts confirmed uploads and verifies their returned media identity", async () => {
  const media = "22222222-2222-4222-8222-222222222222";
  const input = {
    body: "",
    clientKey: "upload",
    attachments: [{ source: "upload" as const, mediaAssetId: media, name: "New.mp4" }],
  };
  vi.mocked(api.post).mockResolvedValue({
    ...comment,
    attachments: [
      { id, mediaAssetId: media, name: "New.mp4", mediaKind: "video", contentType: "video/mp4" },
    ],
  });
  await postTaskComment(id, "1", input);
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/comments`, {
    service: "aurora",
    data: input,
  });
  await expect(
    postTaskComment(id, "1", {
      ...input,
      attachments: [...input.attachments, ...input.attachments],
    })
  ).rejects.toThrow("Duplicate");
  await expect(
    postTaskComment(id, "1", {
      ...input,
      attachments: [{ ...input.attachments[0]!, name: "../file" }],
    })
  ).rejects.toThrow();
  vi.mocked(api.post).mockResolvedValue({
    ...comment,
    attachments: [
      { id, mediaAssetId: id, name: "Other", mediaKind: "video", contentType: "video/mp4" },
    ],
  });
  await expect(postTaskComment(id, "1", input)).rejects.toThrow("acknowledgement mismatch");
});

it("validates structured task mentions before posting", async () => {
  const mention = { userId: "2", label: "Artist" };
  vi.mocked(api.post).mockResolvedValue({ ...comment, mentions: [mention] });
  await postTaskComment(id, "1", { body: "Hello @Artist", clientKey: "key", mentions: [mention] });
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/comments`, {
    service: "aurora",
    data: { body: "Hello @Artist", clientKey: "key", mentions: [mention] },
  });
  vi.mocked(api.post).mockClear();
  for (const mentions of [
    [mention, mention],
    [{ ...mention, userId: "1" }],
    [{ ...mention, label: "@Artist" }],
    Array.from({ length: 21 }, (_, i) => ({ userId: String(i + 2), label: "Artist" })),
  ]) {
    await expect(
      postTaskComment(id, "1", { body: "@Artist", clientKey: "key", mentions })
    ).rejects.toThrow();
  }
  await expect(
    postTaskComment(id, "1", { body: "Gone", clientKey: "key", mentions: [mention] })
  ).rejects.toThrow("Mention missing");
  expect(api.post).not.toHaveBeenCalled();
});

it("rejects an acknowledgement that lost the selected mention", async () => {
  vi.mocked(api.post).mockResolvedValue(comment);
  await expect(
    postTaskComment(id, "1", {
      body: "@Artist",
      clientKey: "key",
      mentions: [{ userId: "2", label: "Artist" }],
    })
  ).rejects.toThrow("acknowledgement mismatch");
});

it("uses explicit manage permission and the existing comment deletion endpoint", async () => {
  vi.mocked(api.get).mockResolvedValue({
    userId: "1",
    permissions: ["tasks.comment", "tasks.manage"],
  });
  expect(await fetchTaskCommentAccess("crew", "1", new AbortController().signal)).toEqual({
    allowed: true,
    canManage: true,
    canInvite: false,
  });
  await removeTaskComment(id);
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/crew-task-comments/${id}`, {
    service: "aurora",
  });
  await expect(removeTaskComment("bad")).rejects.toThrow();
  vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"));
  await expect(removeTaskComment(id)).rejects.toThrow("Forbidden");
});

it("edits at the expected version and rejects incorrect acknowledgements", async () => {
  const input = {
    expectedVersion: 1,
    body: "Updated @Artist",
    mentions: [{ userId: "2", label: "Artist" }],
  };
  const updated = { ...comment, body: input.body, mentions: input.mentions, version: 2 };
  vi.mocked(api.patch).mockResolvedValue(updated);
  await editTaskComment(id, id, input);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-task-comments/${id}`, {
    service: "aurora",
    data: input,
  });
  for (const changed of [
    { ...updated, version: 1 },
    { ...updated, body: "Other" },
    { ...updated, mentions: [] },
    { ...updated, deletedAt: comment.createdAt },
    { ...updated, taskId: "22222222-2222-4222-8222-222222222222" },
  ]) {
    vi.mocked(api.patch).mockResolvedValue(changed);
    await expect(editTaskComment(id, id, input)).rejects.toThrow("acknowledgement mismatch");
  }
  vi.mocked(api.patch).mockClear();
  for (const bad of [
    { ...input, body: " " },
    { ...input, expectedVersion: 0 },
    { ...input, body: "Missing label" },
  ])
    await expect(editTaskComment(id, id, bad)).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
