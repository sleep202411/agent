import * as DocumentPicker from "expo-document-picker";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const metadata = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((s) => !/[\r\n/\\]/.test(s)),
  contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
export type ReceiptUpload = {
  id: string;
  file: Blob;
  metadata: z.infer<typeof metadata>;
  uploaded: boolean;
};
function path(crewId: string, draftId: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .parse(crewId);
  z.string().uuid().parse(draftId);
  return `/crews/${crewId}/expense-drafts/${draftId}/receipts`;
}
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Receipt upload session expired");
}
export async function pickExpenseReceipt(
  generation: number,
  signal: AbortSignal
): Promise<ReceiptUpload | null> {
  current(generation, signal);
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/png", "image/jpeg"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  current(generation, signal);
  if (picked.canceled || !picked.assets[0]) return null;
  const selected = picked.assets[0];
  if (selected.size !== undefined && (selected.size <= 0 || selected.size > 10 * 1024 * 1024))
    throw new Error("Choose a nonempty PDF, PNG or JPEG up to 10 MB.");
  const response = await fetch(selected.uri, { signal });
  if (!response.ok) throw new Error("Cannot read selected receipt");
  const file = await response.blob();
  current(generation, signal);
  const data = metadata.parse({
    name: selected.name,
    contentType: selected.mimeType || file.type,
    sizeBytes: file.size,
  });
  return { id: uuid.v4(), file, metadata: data, uploaded: false };
}
export async function uploadExpenseReceipt(
  crewId: string,
  draftId: string,
  upload: ReceiptUpload,
  generation: number,
  signal: AbortSignal
) {
  const base = `${path(crewId, draftId)}/${z.string().uuid().parse(upload.id)}`;
  const data = metadata.parse(upload.metadata);
  if (upload.file.size !== data.sizeBytes) throw new Error("Receipt bytes changed");
  current(generation, signal);
  if (!upload.uploaded) {
    const signed = z
      .object({
        url: z.string().url(),
        method: z.literal("PUT"),
        headers: z.record(z.string(), z.string()),
        expiresAt: z.string().datetime({ offset: true }),
      })
      .parse(await api.post(base, { service: "aurora", data, signal }));
    current(generation, signal);
    const url = new URL(signed.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      Date.parse(signed.expiresAt) <= Date.now()
    )
      throw new Error("Receipt upload link is invalid or expired");
    if (
      Object.keys(signed.headers).some((k) => ["authorization", "cookie"].includes(k.toLowerCase()))
    )
      throw new Error("Unexpected receipt upload credentials");
    const result = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": data.contentType, ...signed.headers },
      body: upload.file,
      signal,
      credentials: "omit",
    });
    if (!result.ok) throw new Error(`Receipt upload failed (${result.status})`);
    upload.uploaded = true;
    current(generation, signal);
  }
  const confirmed = z
    .object({ id: z.string().uuid() })
    .parse(await api.post(`${base}/confirm`, { service: "aurora", data: {}, signal }));
  current(generation, signal);
  if (confirmed.id !== upload.id) throw new Error("Receipt confirmation does not match");
  return { id: upload.id, name: data.name };
}
export async function fetchExpenseReceipts(
  crewId: string,
  draftId: string,
  after: string | null,
  signal: AbortSignal
) {
  if (after) z.string().uuid().parse(after);
  const page = z
    .object({
      items: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1) })),
      nextCursor: z.string().uuid().nullable(),
    })
    .parse(
      await api.get(path(crewId, draftId), {
        service: "aurora",
        signal,
        params: after ? { after } : undefined,
      })
    );
  if (
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (after !== null && page.nextCursor === after)
  )
    throw new Error("Receipt pagination changed. Refresh to reload.");
  return page;
}
