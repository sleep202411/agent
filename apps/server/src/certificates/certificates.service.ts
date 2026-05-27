import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import type {
  CertificateVerificationDTO,
  UserCertificateDTO,
  VerifiedCertificateDTO,
} from './dto';

interface CertificateRow {
  id: string;
  cert_no: string;
  title: string;
  issuer: string;
  storage_provider: string;
  bucket: string | null;
  region: string | null;
  object_key: string | null;
  external_url: string | null;
  issued_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
  ) {}

  async listForUser(userId: string): Promise<UserCertificateDTO[]> {
    const rows = await this.prisma.$queryRaw<CertificateRow[]>`
      SELECT
        cert.id,
        cert.cert_no,
        cert.title,
        cert.issuer,
        asset.storage_provider,
        asset.bucket,
        asset.region,
        asset.object_key,
        asset.external_url,
        cert.issued_at,
        cert.revoked_at,
        cert.revoked_reason
      FROM user_certificates cert
      INNER JOIN media_assets asset
        ON asset.id = cert.image_asset_id
      WHERE cert.user_id = ${userId}
        AND cert.revoked_at IS NULL
        AND asset.deleted_at IS NULL
        AND asset.status = 'ready'
      ORDER BY cert.issued_at DESC, cert.created_at DESC
    `;

    return rows.map((row) => {
      const certificate = this.toVerifiedCertificate(row);
      return {
        id: certificate.id,
        certNo: certificate.certNo,
        title: certificate.title,
        description: null,
        program: null,
        issuer: certificate.issuer,
        imageUrl: certificate.imageUrl,
        issuedAt: certificate.issuedAt,
        validUntil: null,
      };
    });
  }

  async verify(certNo: string): Promise<CertificateVerificationDTO> {
    const rows = await this.prisma.$queryRaw<CertificateRow[]>`
      SELECT
        cert.id,
        cert.cert_no,
        cert.title,
        cert.issuer,
        asset.storage_provider,
        asset.bucket,
        asset.region,
        asset.object_key,
        asset.external_url,
        cert.issued_at,
        cert.revoked_at,
        cert.revoked_reason
      FROM user_certificates cert
      INNER JOIN media_assets asset
        ON asset.id = cert.image_asset_id
      WHERE cert.cert_no = ${certNo}
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
    const certificate = this.toVerifiedCertificate(row);

    return {
      certNo: row.cert_no,
      valid: !revoked,
      status: revoked ? 'revoked' : 'valid',
      certificate,
    };
  }

  private toVerifiedCertificate(row: CertificateRow): VerifiedCertificateDTO {
    return {
      id: row.id,
      certNo: row.cert_no,
      title: row.title,
      issuer: row.issuer,
      imageUrl: this.assetUrls.resolve({
        storageProvider: row.storage_provider,
        bucket: row.bucket,
        region: row.region,
        objectKey: row.object_key,
        externalUrl: row.external_url,
      }),
      issuedAt: row.issued_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
      revokedReason: row.revoked_reason,
    };
  }
}
