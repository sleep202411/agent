import * as DocumentPicker from "expo-document-picker";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().uuid();
const metadata = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (s) =>
        !/["/\\]/.test(s) && [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    ),
  contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
const attachment = metadata.extend({
  id,
  ready: z.boolean(),
  shared: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});
export type CaseAttachment = z.infer<typeof attachment>;
export type CaseUpload = {
  id: string;
  file: Blob;
  metadata: z.infer<typeof metadata>;
  uploaded: boolean;
};
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Evidence session expired.");
}
const base = (caseId: string) => `/crew-disputes/${id.parse(caseId)}/attachments`;
const evidenceBase = (caseId: string, taskId?: string) =>
  taskId
    ? `/crew-tasks/${id.parse(taskId)}/dispute-drafts/${id.parse(caseId)}/attachments`
    : base(caseId);
export async function fetchCaseEvidence(
  caseId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  current(generation, signal);
  const page = z.object({ items: z.array(attachment), nextBeforeId: id.nullable() }).parse(
    await api.get(base(caseId), {
      service: "aurora",
      signal,
      retry: false,
      params: { limit: 20, ...(cursor ? { beforeId: id.parse(cursor) } : {}) },
    })
  );
  current(generation, signal);
  if (
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (cursor && page.nextBeforeId === cursor)
  )
    throw new Error("Invalid evidence pagination.");
  return page;
}
export async function pickCaseEvidence(
  generation: number,
  signal: AbortSignal
): Promise<CaseUpload | null> {
  current(generation, signal);
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/png", "image/jpeg"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  current(generation, signal);
  if (picked.canceled) return null;
  const selected = picked.assets[0];
  if (picked.assets.length !== 1 || !selected) throw new Error("Select one evidence file.");
  if (
    selected.size !== undefined &&
    (!Number.isSafeInteger(selected.size) || selected.size < 1 || selected.size > 10 * 1024 * 1024)
  )
    throw new Error("Choose a nonempty PDF, PNG or JPEG up to 10 MB.");
  let file: Blob;
  if (selected.file) file = selected.file;
  else {
    const response = await fetch(selected.uri, { signal });
    if (!response.ok) throw new Error("Cannot read selected evidence.");
    file = await response.blob();
  }
  current(generation, signal);
  return {
    id: uuid.v4(),
    file,
    metadata: metadata.parse({
      name: selected.name,
      contentType: selected.mimeType || file.type,
      sizeBytes: file.size,
    }),
    uploaded: false,
  };
}
export async function confirmCaseEvidence(
  caseId: string,
  attachmentId: string,
  generation: number,
  signal: AbortSignal,
  taskId?: string
) {
  current(generation, signal);
  const saved = z.object({ id }).parse(
    await api.post(`${evidenceBase(caseId, taskId)}/${id.parse(attachmentId)}/confirm`, {
      service: "aurora",
      signal,
      retry: false,
      data: {},
    })
  );
  current(generation, signal);
  if (saved.id !== attachmentId) throw new Error("Evidence receipt mismatch.");
  return saved;
}
export function evidenceUrl(input: unknown) {
  const result = z
    .object({ url: z.string().url(), expiresAt: z.string().datetime({ offset: true }) })
    .parse(input);
  const url = new URL(result.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(result.expiresAt) <= Date.now()
  )
    throw new Error("Evidence link is invalid or expired.");
  return result;
}
export async function readCaseEvidence(
  caseId: string,
  attachmentId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const result = evidenceUrl(
    await api.get(`${base(caseId)}/${id.parse(attachmentId)}/read`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  return result;
}
export async function uploadCaseEvidence(
  caseId: string,
  upload: CaseUpload,
  generation: number,
  signal: AbortSignal,
  taskId?: string
) {
  current(generation, signal);
  const data = metadata.parse(upload.metadata);
  if (upload.file.size !== data.sizeBytes) throw new Error("Evidence bytes changed.");
  if (!upload.uploaded) {
    const signed = z
      .object({
        url: z.string(),
        expiresAt: z.string(),
        method: z.literal("PUT"),
        headers: z.record(z.string(), z.string()),
      })
      .parse(
        await api.post(`${evidenceBase(caseId, taskId)}/${id.parse(upload.id)}`, {
          service: "aurora",
          signal,
          retry: false,
          data,
        })
      );
    current(generation, signal);
    evidenceUrl(signed);
    if (
      Object.keys(signed.headers).some((k) => ["authorization", "cookie"].includes(k.toLowerCase()))
    )
      throw new Error("Unexpected evidence upload credentials.");
    const put = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": data.contentType, ...signed.headers },
      body: upload.file,
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!put.ok) throw new Error(`Evidence upload failed (${put.status}).`);
    upload.uploaded = true;
    current(generation, signal);
  }
  return confirmCaseEvidence(caseId, upload.id, generation, signal, taskId);
}
