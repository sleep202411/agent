import { z } from "zod";
import { api } from "@/lib/api-client";

export const normalizeCertificateNumber = (value: string) => value.trim().toUpperCase();
export const isCertificateNumber = (value: string) =>
  value.length <= 32 && /^FD-[A-Z0-9]{2,12}-[0-9]{4}-[A-Z0-9]{6}$/.test(value);
const certificate = z.object({
  id: z.string(),
  certNo: z.string(),
  title: z.string(),
  issuer: z.string(),
  imageUrl: z.string().nullable(),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
});
const result = z.object({
  certNo: z.string(),
  valid: z.boolean(),
  status: z.enum(["valid", "revoked", "not_found"]),
  certificate: certificate.nullable(),
});
export type VerificationResult = z.infer<typeof result>;
export async function verifyCertificate(
  value: string,
  signal: AbortSignal
): Promise<VerificationResult> {
  const certNo = normalizeCertificateNumber(value);
  if (!isCertificateNumber(certNo)) throw new Error("Invalid certificate number format");
  const parsed = result.parse(
    await api.get("/certificates/verify", {
      service: "aurora",
      params: { certNo },
      signal,
      retry: false,
    })
  );
  if (
    parsed.certNo !== certNo ||
    parsed.valid !== (parsed.status === "valid") ||
    (parsed.status === "not_found"
      ? parsed.certificate !== null
      : parsed.certificate?.certNo !== certNo)
  )
    throw new Error("Invalid certificate verification response");
  return parsed;
}
