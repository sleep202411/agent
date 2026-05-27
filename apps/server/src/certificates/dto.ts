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
