export type CertificateVerificationStatus = "valid" | "revoked" | "not_found";

export interface VerifiedCertificate {
  id: string;
  certNo: string;
  title: string;
  issuer: string;
  imageUrl: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface CertificateVerificationResult {
  certNo: string;
  valid: boolean;
  status: CertificateVerificationStatus;
  certificate: VerifiedCertificate | null;
}

export class CertificateVerifyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(certificateErrorDetail(body) || `Certificate verification failed (${status})`);
    this.name = "CertificateVerifyApiError";
  }
}

export async function verifyCertificate(certNo: string): Promise<CertificateVerificationResult> {
  const res = await fetch(`/aurora/certificates/verify?certNo=${encodeURIComponent(certNo)}`, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Preserve a non-JSON upstream error; a response body can only be read once.
    }
    throw new CertificateVerifyApiError(res.status, body);
  }

  return (await res.json()) as CertificateVerificationResult;
}

export function certificateErrorDetail(body: unknown): string | null {
  if (typeof body === "string") return body.trim() || null;
  if (!body || typeof body !== "object") return null;
  const value = "message" in body ? body.message : "msg" in body ? body.msg : null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string").join("; ") || null;
  return null;
}
