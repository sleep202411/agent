import { api } from "@/lib/api";

/**
 * Per-document comment threads (Figma-style). Threads are anchored to a canvas
 * node via `blockId`. Backed by the documents platform's comment routes
 * (PlatformDocumentCommentThread / Comment) under `/aurora/documents/:id/...`.
 */

export interface CommentDto {
  id: string;
  threadId: string;
  documentId: string;
  body: string;
  createdById: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThreadDto {
  id: string;
  documentId: string;
  blockId: string | null;
  anchor: unknown;
  title: string | null;
  status: "open" | "resolved";
  createdById: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: CommentDto[];
}

export interface CreateThreadInput {
  blockId?: string;
  anchor?: Record<string, unknown>;
  title?: string;
  body: string;
}

export async function listCommentThreads(documentId: string): Promise<CommentThreadDto[]> {
  const data = await api.get<{ threads: CommentThreadDto[] }>(
    `/aurora/documents/${documentId}/comments`
  );
  return data.threads;
}

export async function createCommentThread(
  documentId: string,
  input: CreateThreadInput
): Promise<CommentThreadDto> {
  const data = await api.post<{ thread: CommentThreadDto }>(
    `/aurora/documents/${documentId}/comments`,
    { data: input }
  );
  return data.thread;
}

export async function addComment(
  documentId: string,
  threadId: string,
  body: string
): Promise<CommentDto> {
  const data = await api.post<{ comment: CommentDto }>(
    `/aurora/documents/${documentId}/comments/${threadId}/replies`,
    { data: { body } }
  );
  return data.comment;
}

export async function resolveCommentThread(
  documentId: string,
  threadId: string
): Promise<CommentThreadDto> {
  const data = await api.post<{ thread: CommentThreadDto }>(
    `/aurora/documents/${documentId}/comments/${threadId}/resolve`
  );
  return data.thread;
}
