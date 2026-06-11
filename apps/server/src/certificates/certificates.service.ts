import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  MediaAssetKind,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { OutputStorageService } from '../infra/storage/storage.types';
import type {
  AdminCertificateAssetDTO,
  AdminCertificateDTO,
  AdminCertificateListDTO,
  CertificateVerificationDTO,
  CreateAdminCertificateInput,
  ListAdminCertificatesQuery,
  UpdateAdminCertificateInput,
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

type CertificateWithAsset = Prisma.UserCertificateGetPayload<{
  include: { imageAsset: true };
}>;

// Certificate image cap. Cert artwork is a single rendered PNG/JPG — generous
// but bounded so a bad upload can't blow through request limits.
const CERT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly outputStorage: OutputStorageService,
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

  // ─────────────────────────────── Admin CRUD ──────────────────────────────
  //
  // Backs the admin-ui 证书管理 console. Ops type a raw userId + upload the
  // certificate image (no user-profile resolution yet). Cert numbers are
  // generated here, opaque + collision-checked against the unique index.

  async listAdmin(
    query: ListAdminCertificatesQuery,
  ): Promise<AdminCertificateListDTO> {
    const where: Prisma.UserCertificateWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.certNo) {
      where.certNo = { contains: query.certNo, mode: 'insensitive' };
    }
    if (query.status === 'active') where.revokedAt = null;
    else if (query.status === 'revoked') where.revokedAt = { not: null };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userCertificate.count({ where }),
      this.prisma.userCertificate.findMany({
        where,
        include: { imageAsset: true },
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.adminCertificateDto(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createAdmin(
    input: CreateAdminCertificateInput,
  ): Promise<AdminCertificateDTO> {
    await this.assertUsableImageAsset(input.imageAssetId);
    const issuedAt = input.issuedAt ?? new Date();

    // Operator-pinned number (e.g. the one already printed on the artwork):
    // store it verbatim. The unique index is the source of truth — a clash
    // surfaces as a clear conflict instead of silently re-generating.
    if (input.certNo) {
      try {
        const cert = await this.prisma.userCertificate.create({
          data: {
            userId: input.userId,
            certNo: input.certNo,
            title: input.title,
            issuer: input.issuer,
            imageAssetId: input.imageAssetId,
            issuedAt,
          },
          include: { imageAsset: true },
        });
        return this.adminCertificateDto(cert);
      } catch (err) {
        if (isUniqueCertNoViolation(err)) {
          throw new ConflictException({
            code: 'CERT_NO_TAKEN',
            msg: `Certificate number ${input.certNo} is already in use.`,
          });
        }
        throw err;
      }
    }

    // Auto-generate. The random suffix makes collisions vanishingly unlikely,
    // but we retry on the off chance the unique index rejects one rather than
    // silently issuing a duplicate.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const certNo = generateCertNo('GEN', issuedAt);
      try {
        const cert = await this.prisma.userCertificate.create({
          data: {
            userId: input.userId,
            certNo,
            title: input.title,
            issuer: input.issuer,
            imageAssetId: input.imageAssetId,
            issuedAt,
          },
          include: { imageAsset: true },
        });
        return this.adminCertificateDto(cert);
      } catch (err) {
        // On a (vanishingly rare) cert-no collision, retry with a fresh
        // number; once the loop is exhausted we throw the friendly error
        // below. Any other error bubbles immediately.
        if (isUniqueCertNoViolation(err)) continue;
        throw err;
      }
    }

    throw new ServiceUnavailableException({
      code: 'CERT_NO_GENERATION_FAILED',
      msg: 'Could not allocate a unique certificate number.',
    });
  }

  async updateAdmin(
    id: string,
    input: UpdateAdminCertificateInput,
  ): Promise<AdminCertificateDTO> {
    await this.getCertOrThrow(id);
    if (input.imageAssetId)
      await this.assertUsableImageAsset(input.imageAssetId);

    const cert = await this.prisma.userCertificate.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.issuer !== undefined ? { issuer: input.issuer } : {}),
        ...(input.imageAssetId !== undefined
          ? { imageAssetId: input.imageAssetId }
          : {}),
        ...(input.issuedAt !== undefined ? { issuedAt: input.issuedAt } : {}),
      },
      include: { imageAsset: true },
    });
    return this.adminCertificateDto(cert);
  }

  async revokeAdmin(
    id: string,
    reason: string | null,
  ): Promise<AdminCertificateDTO> {
    const existing = await this.getCertOrThrow(id);
    const cert = await this.prisma.userCertificate.update({
      where: { id },
      // Preserve the original revocation timestamp if it's already revoked;
      // only (re)set the reason. Otherwise stamp now.
      data: {
        revokedAt: existing.revokedAt ?? new Date(),
        revokedReason: reason,
      },
      include: { imageAsset: true },
    });
    return this.adminCertificateDto(cert);
  }

  async restoreAdmin(id: string): Promise<AdminCertificateDTO> {
    await this.getCertOrThrow(id);
    const cert = await this.prisma.userCertificate.update({
      where: { id },
      data: { revokedAt: null, revokedReason: null },
      include: { imageAsset: true },
    });
    return this.adminCertificateDto(cert);
  }

  async deleteAdmin(id: string): Promise<{ id: string }> {
    const cert = await this.getCertOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.userCertificate.delete({ where: { id } });
      // The image FK is onDelete:Restrict, so the cert row must go first.
      // Soft-delete the image only if no other cert still references it.
      const stillReferenced = await tx.userCertificate.count({
        where: { imageAssetId: cert.imageAssetId },
      });
      if (stillReferenced === 0) {
        await tx.mediaAsset.update({
          where: { id: cert.imageAssetId },
          data: { status: MediaAssetStatus.deleted, deletedAt: new Date() },
        });
      }
    });
    return { id };
  }

  async uploadAdminMedia(
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
  ): Promise<{ asset: AdminCertificateAssetDTO }> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException({
        code: 'CERT_MEDIA_FILE_REQUIRED',
        msg: 'Missing upload file.',
      });
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException({
        code: 'CERT_MEDIA_INVALID_TYPE',
        msg: 'Certificate image must be an image file.',
      });
    }
    if (file.size > CERT_IMAGE_MAX_BYTES) {
      throw new BadRequestException({
        code: 'CERT_MEDIA_FILE_TOO_LARGE',
        msg: 'Certificate image is too large (max 20MB).',
      });
    }

    const objectKey = `certificates/image/${randomUUID()}-${sanitizeFilename(
      file.originalname,
    )}`;

    let uploaded: Awaited<ReturnType<OutputStorageService['upload']>>;
    try {
      uploaded = await this.outputStorage.upload({
        body: file.buffer,
        key: objectKey,
        contentType: file.mimetype || 'application/octet-stream',
        filename: sanitizeFilename(file.originalname),
      });
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'CERT_MEDIA_STORAGE_UNAVAILABLE',
        msg:
          err instanceof Error && err.message
            ? err.message
            : 'Media storage is unavailable.',
      });
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        kind: MediaAssetKind.image,
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: azureBlobContainerName(),
        region: azureBlobRegion(),
        objectKey: uploaded.storagePath,
        contentType: file.mimetype || 'application/octet-stream',
        sizeBytes: BigInt(uploaded.bytes),
        checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
        visibility: MediaAssetVisibility.public,
        status: MediaAssetStatus.ready,
      },
    });

    return {
      asset: {
        id: asset.id,
        url: this.resolveAssetUrl(asset),
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
      },
    };
  }

  private async getCertOrThrow(id: string) {
    const cert = await this.prisma.userCertificate.findUnique({
      where: { id },
    });
    if (!cert) {
      throw new NotFoundException({
        code: 'CERT_NOT_FOUND',
        msg: 'Certificate not found.',
      });
    }
    return cert;
  }

  private async assertUsableImageAsset(imageAssetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: imageAssetId },
      select: { id: true, kind: true, status: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException({
        code: 'CERT_IMAGE_ASSET_NOT_FOUND',
        msg: 'Certificate image asset not found.',
      });
    }
    if (asset.kind !== MediaAssetKind.image) {
      throw new BadRequestException({
        code: 'CERT_IMAGE_ASSET_INVALID_KIND',
        msg: 'Certificate image asset must be an image.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new BadRequestException({
        code: 'CERT_IMAGE_ASSET_NOT_READY',
        msg: 'Certificate image asset is not ready.',
      });
    }
  }

  private adminCertificateDto(cert: CertificateWithAsset): AdminCertificateDTO {
    return {
      id: cert.id,
      userId: cert.userId,
      certNo: cert.certNo,
      title: cert.title,
      issuer: cert.issuer,
      imageAssetId: cert.imageAssetId,
      imageUrl: this.resolveAssetUrl(cert.imageAsset),
      issuedAt: cert.issuedAt.toISOString(),
      revokedAt: cert.revokedAt?.toISOString() ?? null,
      revokedReason: cert.revokedReason,
      createdAt: cert.createdAt.toISOString(),
      updatedAt: cert.updatedAt.toISOString(),
    };
  }

  private resolveAssetUrl(
    asset: {
      storageProvider: string;
      bucket: string | null;
      region: string | null;
      objectKey: string | null;
      externalUrl: string | null;
    } | null,
  ): string | null {
    if (!asset) return null;
    try {
      return this.assetUrls.resolve(asset);
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────── helpers ─────────────────────────────────

const DEFAULT_AZURE_BLOB_CONTAINER = 'foundry-outputs';
// Cert-no random alphabet: uppercase A-Z + 0-9, matching CERT_NO_RE's final
// group. Opaque by design — never encodes user / db id / name / level.
const CERT_NO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateCertNo(code: string, when: Date): string {
  const yy = String(when.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  return `FD-${code}-${yy}${mm}-${randomToken(6)}`;
}

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CERT_NO_ALPHABET[bytes[i] % CERT_NO_ALPHABET.length];
  }
  return out;
}

function sanitizeFilename(value: string): string {
  const clean = value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'upload.bin';
}

function cleanSegment(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function azureBlobContainerName(): string {
  return (
    cleanSegment(process.env.AZURE_BLOB_CONTAINER) ??
    DEFAULT_AZURE_BLOB_CONTAINER
  );
}

function azureBlobRegion(): string | null {
  return (
    cleanSegment(process.env.AZURE_BLOB_REGION) ??
    cleanSegment(process.env.AZURE_STORAGE_REGION)
  );
}

function isUniqueCertNoViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
