import { beforeEach, expect, it, vi } from "vitest";
import {
  documentCommentPending,
  writeDocumentComment,
  type DocumentCommentCommand,
} from "./document-comments-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, doc: string) => ({
    read: () => h.records.get(`${namespace}:${user}:${doc}`) ?? null,
    write: (value: string) => h.records.set(`${namespace}:${user}:${doc}`, value),
  }),
}));
const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const doc = id(1),
  date = "2026-10-05T00:00:00Z";
const comment = {
  id: id(3),
  threadId: id(2),
  documentId: doc,
  createdById: "42",
  createdAt: date,
  editedAt: null,
  body: "Review this",
};
const thread = {
  id: id(2),
  documentId: doc,
  blockId: null,
  anchor: null,
  title: null,
  status: "open",
  createdById: "42",
  resolvedById: null,
  resolvedAt: null,
  createdAt: date,
  updatedAt: date,
  comments: [comment],
};
const create: DocumentCommentCommand = {
  clientKey: id(4),
  documentId: doc,
  kind: "create",
  body: " Review this ",
};
const run = (command: DocumentCommentCommand = create) =>
  writeDocumentComment(command, doc, "42", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue({ threads: [] });
  h.post.mockResolvedValue({ thread });
});
it("persists before POST, matches the receipt, and clears only the confirmed action", async () => {
  h.post.mockImplementation(async () => {
    expect(documentCommentPending(doc, "42", 1).read()).toEqual({ ...create, body: "Review this" });
    return { thread };
  });
  await run();
  expect(h.post).toHaveBeenCalledWith(
    `/documents/${doc}/comments`,
    expect.objectContaining({ retry: false, data: { body: "Review this" } })
  );
  expect(documentCommentPending(doc, "42", 1).read()).toBeNull();
});
it("retains uncertain sends across reopening and never replays them", async () => {
  h.post.mockRejectedValue(new Error("Response lost"));
  await expect(run()).rejects.toThrow("Response lost");
  await expect(run()).rejects.toThrow("pending comment");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(documentCommentPending(doc, "42", 1).read()?.kind).toBe("create");
  expect(documentCommentPending(doc, "other", 1).read()).toBeNull();
});
it("verifies reply and resolve identities", async () => {
  h.get.mockResolvedValue({ threads: [thread] });
  h.post.mockResolvedValue({ comment: { ...comment, id: id(5), body: "Reply" } });
  await run({
    clientKey: id(4),
    documentId: doc,
    kind: "reply",
    threadId: thread.id,
    body: "Reply",
  });
  h.post.mockResolvedValue({
    thread: { ...thread, status: "resolved", resolvedById: "42", resolvedAt: date },
  });
  await run({ clientKey: id(6), documentId: doc, kind: "resolve", threadId: thread.id });
  expect(documentCommentPending(doc, "42", 1).read()).toBeNull();
});
it.each([
  { ...thread, documentId: id(9) },
  { ...thread, createdById: "other" },
  { ...thread, comments: [{ ...comment, body: "Different" }] },
  { ...thread, comments: [{ ...comment, threadId: id(9) }] },
])("retains invalid receipts for review", async (value) => {
  h.post.mockResolvedValue({ thread: value });
  await expect(run()).rejects.toThrow();
  expect(documentCommentPending(doc, "42", 1).read()).not.toBeNull();
});
it("rejects a missing reply target and denied preflight without persisting a send", async () => {
  await expect(
    run({ clientKey: id(4), documentId: doc, kind: "reply", threadId: id(2), body: "Reply" })
  ).rejects.toThrow("no longer exists");
  h.get.mockRejectedValue(new Error("Access denied"));
  await expect(run()).rejects.toThrow("Access denied");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.records.size).toBe(0);
});
it("rejects foreign scope, stale sessions and oversized content before requests", async () => {
  await expect(run({ ...create, documentId: id(9) })).rejects.toThrow("mismatch");
  await expect(run({ ...create, body: "x".repeat(5001) })).rejects.toThrow();
  h.generation = 2;
  await expect(run()).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
});
it("does not clear pending state after an account change during POST", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { thread };
  });
  await expect(run()).rejects.toThrow("session");
  expect(documentCommentPending(doc, "42", 2).read()).not.toBeNull();
});
it("admits at most one simultaneous write", async () => {
  const results = await Promise.allSettled([run(), run()]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("does not overwrite another person's completed resolution", async () => {
  h.get.mockResolvedValue({
    threads: [{ ...thread, status: "resolved", resolvedById: "77", resolvedAt: date }],
  });
  await expect(
    run({ clientKey: id(4), documentId: doc, kind: "resolve", threadId: thread.id })
  ).rejects.toThrow("already resolved");
  expect(h.post).not.toHaveBeenCalled();
  expect(documentCommentPending(doc, "42", 1).read()).toBeNull();
});
