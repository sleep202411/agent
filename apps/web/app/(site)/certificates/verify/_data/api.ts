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
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Certificate verification failed (${status})`
    );
    this.name = "CertificateVerifyApiError";
  }
}

export async function verifyCertificate(certNo: string): Promise<CertificateVerificationResult> {
  const res = await fetch(`/aurora/certificates/verify?certNo=${encodeURIComponent(certNo)}`, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new CertificateVerifyApiError(res.status, body);
  }

  return (await res.json()) as CertificateVerificationResult;
}
