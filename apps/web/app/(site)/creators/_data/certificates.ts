export interface CreatorCertificate {
  id: string;
  certNo: string;
  title: string;
  description?: string | null;
  program?: string | null;
  issuer: string;
  imageUrl: string | null;
  issuedAt: string;
  validUntil: string | null;
}

export class CreatorCertificatesApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Creator certificates request failed (${status})`
    );
    this.name = "CreatorCertificatesApiError";
  }
}

export async function fetchCreatorCertificates(creatorId: string): Promise<CreatorCertificate[]> {
  const res = await fetch(`/aurora/certificates/users/${encodeURIComponent(String(creatorId))}`, {
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
    throw new CreatorCertificatesApiError(res.status, body);
  }

  return (await res.json()) as CreatorCertificate[];
}
