import { z } from 'zod';

const CERT_NO_RE = /^FD-[A-Z0-9]{2,12}-[0-9]{4}-[A-Z0-9]{6}$/;

export const VerifyCertificateQuerySchema = z.object({
  certNo: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((value) => value.toUpperCase())
    .refine((value) => CERT_NO_RE.test(value), {
      message: 'Invalid certificate number format',
    }),
});

export type VerifyCertificateQuery = z.infer<
  typeof VerifyCertificateQuerySchema
>;

export const CertificateUserParamsSchema = z.object({
  userId: z.string().trim().min(1).max(64),
});

export type CertificateUserParams = z.infer<typeof CertificateUserParamsSchema>;

export type CertificateVerificationStatus = 'valid' | 'revoked' | 'not_found';

export interface VerifiedCertificateDTO {
  id: string;
  certNo: string;
  title: string;
  issuer: string;
  imageUrl: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface CertificateVerificationDTO {
  certNo: string;
  valid: boolean;
  status: CertificateVerificationStatus;
  certificate: VerifiedCertificateDTO | null;
}

export interface UserCertificateDTO {
  id: string;
  certNo: string;
  title: string;
  description: string | null;
  program: string | null;
  issuer: string;
  imageUrl: string;
  issuedAt: string;
  validUntil: string | null;
}

// ───────────────────────────── Admin (issue / manage) ─────────────────────────
//
// Admin certificate management. Ops types a raw `userId` + uploads the final
// certificate image; we do NOT resolve the user's profile (name/avatar) yet —
// the userId is shown verbatim. Cert numbers are generated server-side as
// `FD-{CODE}-{YYMM}-{RANDOM}` (random is opaque, never encodes user/db id).

// Code segment of the cert number — 2-12 uppercase alphanumerics (matches the
// middle group of CERT_NO_RE). Defaults to GEN when the operator omits it.
const CERT_CODE_RE = /^[A-Z0-9]{2,12}$/;

export const ListAdminCertificatesQuerySchema = z.object({
  userId: z.string().trim().min(1).max(64).optional(),
  certNo: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((value) => value.toUpperCase())
    .optional(),
  status: z.enum(['all', 'active', 'revoked']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAdminCertificatesQuery = z.infer<
  typeof ListAdminCertificatesQuerySchema
>;

export const AdminCertificateParamsSchema = z.object({
  id: z.string().uuid(),
});
export type AdminCertificateParams = z.infer<
  typeof AdminCertificateParamsSchema
>;

export const CreateAdminCertificateSchema = z
  .object({
    userId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(128),
    issuer: z.string().trim().min(1).max(128).default('FizzDragon'),
    code: z
      .string()
      .trim()
      .min(2)
      .max(12)
      .transform((value) => value.toUpperCase())
      .refine((value) => CERT_CODE_RE.test(value), {
        message: 'Code must be 2-12 uppercase letters/digits.',
      })
      .default('GEN'),
    imageAssetId: z.string().uuid(),
    issuedAt: z.coerce.date().optional(),
  })
  .strict();
export type CreateAdminCertificateInput = z.infer<
  typeof CreateAdminCertificateSchema
>;

export const UpdateAdminCertificateSchema = z
  .object({
    title: z.string().trim().min(1).max(128).optional(),
    issuer: z.string().trim().min(1).max(128).optional(),
    imageAssetId: z.string().uuid().optional(),
    issuedAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });
export type UpdateAdminCertificateInput = z.infer<
  typeof UpdateAdminCertificateSchema
>;

export const RevokeAdminCertificateSchema = z
  .object({
    reason: z.string().trim().max(255).nullable().optional(),
  })
  .strict();
export type RevokeAdminCertificateInput = z.infer<
  typeof RevokeAdminCertificateSchema
>;

export interface AdminCertificateDTO {
  id: string;
  userId: string;
  certNo: string;
  title: string;
  issuer: string;
  imageAssetId: string;
  imageUrl: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCertificateListDTO {
  items: AdminCertificateDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminCertificateAssetDTO {
  id: string;
  url: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
}
