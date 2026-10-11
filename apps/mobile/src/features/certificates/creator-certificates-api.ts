import { z } from "zod";
import { api } from "@/lib/api-client";
import { isCertificateNumber } from "./verify-api";
const certificate = z.object({
  id: z.string().min(1),
  certNo: z.string().refine(isCertificateNumber),
  title: z.string().min(1),
  description: z.string().nullable(),
  program: z.string().nullable(),
  issuer: z.string(),
  imageUrl: z.string().nullable(),
  issuedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
});
export type CreatorCertificate = z.infer<typeof certificate>;
export function publicCertificateImage(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export async function listCreatorCertificates(
  userId: string,
  signal: AbortSignal
): Promise<CreatorCertificate[]> {
  signal.throwIfAborted();
  const id = z.string().trim().min(1).max(64).parse(userId);
  const rows = z.array(certificate).parse(
    await api.get(`/certificates/users/${encodeURIComponent(id)}`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  signal.throwIfAborted();
  if (
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    new Set(rows.map((row) => row.certNo)).size !== rows.length
  )
    throw new Error("Duplicate certificates in public response.");
  return rows;
}
