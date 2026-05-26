import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import type { CertificateVerificationDTO } from './dto';

interface CertificateRow {
  id: string;
  cert_no: string;
  title: string;
  issuer: string;
  image_url: string;
  issued_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(certNo: string): Promise<CertificateVerificationDTO> {
    const rows = await this.prisma.$queryRaw<CertificateRow[]>`
      SELECT
        id,
        cert_no,
        title,
        issuer,
        image_url,
        issued_at,
        revoked_at,
        revoked_reason
      FROM user_certificates
      WHERE cert_no = ${certNo}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return {
        certNo,
        valid: false,
        status: 'not_found',
        certificate: null,
      };
    }

    const revoked = row.revoked_at !== null;

    return {
      certNo: row.cert_no,
      valid: !revoked,
      status: revoked ? 'revoked' : 'valid',
      certificate: {
        id: row.id,
        certNo: row.cert_no,
        title: row.title,
        issuer: row.issuer,
        imageUrl: row.image_url,
        issuedAt: row.issued_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
        revokedReason: row.revoked_reason,
      },
    };
  }
}
