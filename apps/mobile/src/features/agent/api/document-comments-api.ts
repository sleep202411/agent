import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  documentCommentSchema,
  documentThreadSchema,
  listDocumentThreads,
} from "./document-feeds-api";
const id = z.string().uuid();
const base = z.object({ clientKey: id, documentId: id });
export const documentCommentCommand = z.discriminatedUnion("kind", [
  base.extend({
    kind: z.literal("create"),
    body: z.string().trim().min(1).max(5000),
    title: z.string().trim().min(1).max(160).optional(),
    blockId: z.string().trim().min(1).max(128).optional(),
  }),
  base.extend({ kind: z.literal("reply"), threadId: id, body: z.string().trim().min(1).max(5000) }),
  base.extend({ kind: z.literal("resolve"), threadId: id }),
]);
export type DocumentCommentCommand = z.infer<typeof documentCommentCommand>;
export function documentCommentPending(documentId: string, userId: string, generation: number) {
  id.parse(documentId);
  z.string().min(1).parse(userId);
  return pendingRequest(
    documentCommentCommand,
    generation,
    durableRecord("document-comment", userId, documentId)
  );
}
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Document session expired.");
}
/** The server has no comment-write idempotency contract. Never replay an uncertain command. */
export async function writeDocumentComment(
  command: DocumentCommentCommand,
  documentId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  const intent = documentCommentCommand.parse(command);
  if (intent.documentId !== documentId) throw new Error("Comment document mismatch.");
  current(generation, signal);
  const pending = documentCommentPending(documentId, userId, generation);
  if (pending.read()) throw new Error("Review the pending comment before sending another.");
  const threads = await listDocumentThreads(documentId, generation, signal);
  if (intent.kind !== "create" && !threads.some((thread) => thread.id === intent.threadId))
    throw new Error("The comment thread no longer exists.");
  if (
    intent.kind === "resolve" &&
    threads.some((thread) => thread.id === intent.threadId && thread.status === "resolved")
  )
    throw new Error("The comment thread is already resolved. Refresh the discussion.");
  current(generation, signal);
  if (pending.read()) throw new Error("Review the pending comment before sending another.");
  pending.save(intent);
  const path = `/documents/${documentId}/comments`;
  const options = { service: "aurora" as const, signal, retry: false };
  if (intent.kind === "reply") {
    const { comment } = z.object({ comment: documentCommentSchema }).parse(
      await api.post(`${path}/${intent.threadId}/replies`, {
        ...options,
        data: { body: intent.body },
      })
    );
    current(generation, signal);
    if (
      comment.documentId !== documentId ||
      comment.threadId !== intent.threadId ||
      comment.createdById !== userId ||
      comment.body !== intent.body ||
      threads.some((thread) => thread.comments.some((existing) => existing.id === comment.id))
    )
      throw new Error("Comment receipt could not be verified. Review the thread.");
  } else {
    const response =
      intent.kind === "create"
        ? await api.post(path, {
            ...options,
            data: {
              body: intent.body,
              ...(intent.title ? { title: intent.title } : {}),
              ...(intent.blockId ? { blockId: intent.blockId } : {}),
            },
          })
        : await api.post(`${path}/${intent.threadId}/resolve`, options);
    current(generation, signal);
    const { thread } = z.object({ thread: documentThreadSchema }).parse(response);
    if (
      thread.documentId !== documentId ||
      thread.comments.some(
        (comment) => comment.documentId !== documentId || comment.threadId !== thread.id
      )
    )
      throw new Error("Comment thread receipt scope mismatch.");
    if (intent.kind === "create") {
      if (
        threads.some((existing) => existing.id === thread.id) ||
        thread.createdById !== userId ||
        thread.status !== "open" ||
        thread.blockId !== (intent.blockId ?? null) ||
        thread.title !== (intent.title ?? null) ||
        thread.comments.length !== 1 ||
        thread.comments[0].createdById !== userId ||
        thread.comments[0].body !== intent.body
      )
        throw new Error("Comment creation could not be verified. Review the thread list.");
    } else if (
      thread.id !== intent.threadId ||
      thread.status !== "resolved" ||
      thread.resolvedById !== userId ||
      !thread.resolvedAt
    ) {
      throw new Error("Comment resolution could not be verified. Review the thread.");
    }
  }
  current(generation, signal);
  pending.clear(intent.clientKey);
}
