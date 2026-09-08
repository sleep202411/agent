export type AdminCertificateStatusFilter = "all" | "active" | "revoked";

export interface AdminCertificateRow {
  id: string;
  userId: string;
  certNo: string;
  title: string;
  issuer: string;
  credentialType: string;
  imageAssetId: string;
  imageUrl: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCertificatesData {
  items: AdminCertificateRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminCertificateAsset {
  id: string;
  url: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
}
