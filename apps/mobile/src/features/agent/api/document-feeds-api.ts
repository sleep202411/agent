import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
export const documentCommentSchema = z.object({
  id,
  threadId: id,
  documentId: id,
  body: z.string(),
  createdById: z.string().min(1),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
});
export const documentThreadSchema = z.object({
  id,
  documentId: id,
  blockId: z.string().nullable(),
  anchor: z.unknown(),
  title: z.string().nullable(),
  status: z.enum(["open", "resolved"]),
  createdById: z.string().min(1),
  resolvedById: z.string().nullable(),
  resolvedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  comments: z.array(documentCommentSchema),
});
const version = z.object({
  id,
  documentId: id,
  versionNumber: z.number().int().positive(),
  schemaVersion: z.string(),
  sequence: z.number().int().nonnegative(),
  title: z.string().nullable(),
  label: z.string().nullable(),
  source: z.enum(["autosave", "manual", "import", "ai", "system"]),
  sourceId: z.string().nullable(),
  snapshot: z.unknown(),
  crdtStateBase64: z.string().optional(),
  metadata: z.unknown(),
  createdById: z.string().min(1),
  createdAt: timestamp,
});
export type DocumentThread = z.infer<typeof documentThreadSchema>;
export type DocumentVersion = z.infer<typeof version>;
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Document session expired.");
}
function validateRows(rows: { id: string; documentId: string }[], documentId: string) {
  if (
    rows.some((row) => row.documentId !== documentId) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Document feed scope or identity mismatch.");
}
export async function listDocumentThreads(
  documentId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(documentId);
  current(generation, signal);
  const result = await api.get(`/documents/${documentId}/comments`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(generation, signal);
  const { threads } = z.object({ threads: z.array(documentThreadSchema) }).parse(result);
  validateRows(threads, documentId);
  const comments = threads.flatMap((row) => row.comments);
  validateRows(comments, documentId);
  if (threads.some((row) => row.comments.some((item) => item.threadId !== row.id)))
    throw new Error("Document comment thread mismatch.");
  return threads;
}
export async function listDocumentVersions(
  documentId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(documentId);
  current(generation, signal);
  const result = await api.get(`/documents/${documentId}/versions`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(generation, signal);
  const { versions } = z.object({ versions: z.array(version) }).parse(result);
  validateRows(versions, documentId);
  if (new Set(versions.map((row) => row.versionNumber)).size !== versions.length)
    throw new Error("Duplicate document version number.");
  return versions;
}
