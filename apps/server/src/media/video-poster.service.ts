import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { OutputStorageService } from '../infra/storage/storage.types';
import { VIDEO_POSTER_VARIANT_KEY } from '../infra/storage/media-video-poster';

@Injectable()
export class VideoPosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reads: MediaStorageAccessService,
    private readonly storage: OutputStorageService,
  ) {}

  async generate(assetId: string): Promise<{ variantId: string }> {
    const asset = await this.prisma.mediaAsset.findFirstOrThrow({
      where: {
        id: assetId,
        deletedAt: null,
        status: 'ready',
        kind: 'video',
        moderationStatus: { not: 'blocked' },
      },
    });
    const existing = await this.prisma.mediaAssetVariant.findFirst({
      where: {
        assetId,
        variantKey: VIDEO_POSTER_VARIANT_KEY,
        status: 'ready',
        deletedAt: null,
        placements: {
          some: { role: 'primary', status: 'active', deletedAt: null },
        },
      },
      select: { id: true },
    });
    if (existing) return { variantId: existing.id };

    const source = await this.reads.createReadUrl(asset, {
      expiresInSeconds: 300,
    });
    // External imports may only use our own media origins. Provider-owned
    // placements above already resolve through the configured storage SDK.
    if (asset.storageProvider === 'external_url')
      assertPlatformMediaUrl(source.url);
    const body = await extractVideoPoster(source.url);
    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    const stored = await this.storage.upload({
      body,
      // Each attempt owns its bytes; rollback must never delete another worker's poster.
      key: `posters/${assetId}/${randomUUID()}.jpg`,
      contentType: 'image/jpeg',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize with takedown/deletion so a newly published variant cannot
      // escape the asset's existing lifecycle rules.
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
      const available = await tx.mediaAsset.count({
        where: {
          id: assetId,
          deletedAt: null,
          status: 'ready',
          moderationStatus: { not: 'blocked' },
        },
      });
      if (!available) return null;
      const published = await tx.mediaAssetVariant.findFirst({
        where: {
          assetId,
          variantKey: VIDEO_POSTER_VARIANT_KEY,
          status: 'ready',
          deletedAt: null,
          placements: {
            some: { role: 'primary', status: 'active', deletedAt: null },
          },
        },
        select: { id: true },
      });
      if (published) return { variantId: published.id, reused: true };

      const variant = await tx.mediaAssetVariant.upsert({
        where: {
          assetId_variantKey: { assetId, variantKey: VIDEO_POSTER_VARIANT_KEY },
        },
        create: {
          assetId,
          variantKey: VIDEO_POSTER_VARIANT_KEY,
          kind: MediaAssetVariantKind.poster,
          status: MediaAssetVariantStatus.ready,
          contentType: 'image/jpeg',
          sizeBytes: BigInt(body.length),
          checksumSha256,
        },
        update: {
          status: MediaAssetVariantStatus.ready,
          deletedAt: null,
          contentType: 'image/jpeg',
          sizeBytes: BigInt(body.length),
          checksumSha256,
        },
        select: { id: true },
      });
      await tx.mediaObjectPlacement.upsert({
        where: {
          variantId_role_storageProvider_bucket_objectKey: {
            variantId: variant.id,
            role: MediaObjectPlacementRole.primary,
            storageProvider: stored.provider,
            bucket: stored.bucket,
            objectKey: stored.storagePath,
          },
        },
        create: {
          assetId,
          variantId: variant.id,
          role: MediaObjectPlacementRole.primary,
          status: MediaObjectPlacementStatus.active,
          storageProvider: stored.provider,
          bucket: stored.bucket,
          region: stored.region,
          objectKey: stored.storagePath,
          priority: 0,
        },
        update: {
          status: MediaObjectPlacementStatus.active,
          deletedAt: null,
          region: stored.region,
        },
      });
      return { variantId: variant.id, reused: false };
    });
    if (!result || result.reused) {
      await this.storage.deleteObject({
        bucket: stored.bucket,
        region: stored.region,
        storageKey: stored.storagePath,
      });
    }
    if (!result) throw new Error('Video is no longer available.');
    return { variantId: result.variantId };
  }
}

export function extractVideoPoster(
  source: string,
  firstFrame = false,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.MEDIA_FFMPEG_PATH?.trim() || 'ffmpeg',
      [
        '-v',
        'error',
        '-threads',
        '1',
        '-protocol_whitelist',
        'http,https,tcp,tls,crypto',
        '-i',
        source,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        firstFrame
          ? 'scale=960:960:force_original_aspect_ratio=decrease'
          : 'scale=480:480:force_original_aspect_ratio=decrease,thumbnail=12',
        '-filter_threads',
        '1',
        '-threads',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      { encoding: 'buffer', timeout: 45_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        // Do not persist ffmpeg stderr: it can contain signed storage URLs.
        if (error)
          reject(
            new Error(
              error.code === 'ENOENT'
                ? 'Video preview processing requires ffmpeg.'
                : 'Could not extract a video preview.',
            ),
          );
        else if (!stdout.length)
          reject(new Error('Video contains no preview frame.'));
        else resolve(stdout);
      },
    );
  });
}

function assertPlatformMediaUrl(raw: string): void {
  const url = new URL(raw);
  const configured = [
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS,
    process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE,
    process.env.MEDIA_PUBLIC_BASE_URL_AZURE_BLOB,
  ]
    .filter((value): value is string => !!value)
    .map((value) => new URL(value).origin);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (!configured.includes(url.origin) &&
      ![
        'media.fizzdragon.com',
        'media.fizzspace.cn',
        'banner.fizzspace.cn',
      ].includes(url.hostname))
  ) {
    throw new Error(
      'Import the video into media storage before creating its preview.',
    );
  }
}
