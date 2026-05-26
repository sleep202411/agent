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

export function getCreatorCertificates(creatorId: string): CreatorCertificate[] {
  void creatorId;
  // Placeholder until the certificates API is wired. Returning an empty
  // list keeps the profile production-safe without shipping fake records.
  return [];
}
