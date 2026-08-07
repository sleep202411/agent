/**
 * Server-trusted duration for video/audio MediaAssets.
 *
 * Client-reported durations are never authority. On confirm (and when
 * enrichment finds a null duration) we stream the stored object, run ffprobe
 * on the bytes, persist `durationSeconds`, and return that value.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaAssetKind, MediaStorageProvider } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';

const SIGNED_READ_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 60 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PROBE_BYTES = 512 * 1024 * 1024;

const DURATION_KINDS = new Set<MediaAssetKind>([
  MediaAssetKind.video,
  MediaAssetKind.audio,
]);

export interface DurationProbeAsset {
  id?: string;
  kind: MediaAssetKind;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string | null;
  sizeBytes: bigint | null;
  durationSeconds: number | null;
}

@Injectable()
export class MediaAssetDurationService {
  private readonly logger = new Logger(MediaAssetDurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageAccess: MediaStorageAccessService,
  ) {}

  /**
   * Resolve duration for many assets: use stored value when present, otherwise
   * probe storage, persist, and return. Assets that are not video/audio are
   * skipped. Returns a map of assetId → durationSeconds for those resolved.
   */
  async ensureDurations(
    assetIds: readonly string[],
  ): Promise<Map<string, number>> {
    const unique = [
      ...new Set(assetIds.map((id) => id.trim()).filter(Boolean)),
    ];
    const out = new Map<string, number>();
    if (unique.length === 0) return out;

    const rows = await this.prisma.mediaAsset.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: {
        id: true,
        kind: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        externalUrl: true,
        contentType: true,
        sizeBytes: true,
        durationSeconds: true,
      },
    });

    for (const row of rows) {
      if (!DURATION_KINDS.has(row.kind)) continue;
      if (
        row.durationSeconds != null &&
        Number.isFinite(row.durationSeconds) &&
        row.durationSeconds > 0
      ) {
        out.set(row.id, row.durationSeconds);
        continue;
      }
      try {
        const seconds = await this.probeAndPersist(row);
        if (seconds != null) out.set(row.id, seconds);
      } catch (err) {
        this.logger.warn(
          `duration probe failed asset=${row.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return out;
  }

  /**
   * Probe an object that is about to become a MediaAsset (confirm path).
   * Does not write DB — caller persists the returned seconds.
   */
  async probeObjectDuration(
    asset: Omit<DurationProbeAsset, 'id' | 'durationSeconds'>,
  ): Promise<number> {
    if (!DURATION_KINDS.has(asset.kind)) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_DURATION_KIND_INVALID',
        message: 'Duration probe only applies to video and audio assets.',
      });
    }
    return this.probeFromStorage(asset);
  }

  private async probeAndPersist(
    row: DurationProbeAsset & { id: string },
  ): Promise<number | null> {
    const seconds = await this.probeFromStorage(row);
    await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: { durationSeconds: seconds },
    });
    return seconds;
  }

  private async probeFromStorage(
    asset:
      | Omit<DurationProbeAsset, 'id' | 'durationSeconds'>
      | DurationProbeAsset,
  ): Promise<number> {
    if (asset.sizeBytes != null && asset.sizeBytes > BigInt(MAX_PROBE_BYTES)) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_DURATION_PROBE_TOO_LARGE',
        message: 'Media is too large to inspect for duration.',
      });
    }

    let signed;
    try {
      signed = await this.storageAccess.createReadUrl(
        {
          storageProvider: asset.storageProvider,
          bucket: asset.bucket,
          region: asset.region,
          objectKey: asset.objectKey,
          externalUrl: asset.externalUrl,
        },
        { expiresInSeconds: SIGNED_READ_TTL_SECONDS },
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({
        code: 'MEDIA_DURATION_STORAGE_UNAVAILABLE',
        message: 'Could not read media bytes to measure duration.',
      });
    }

    const tempPath = join(
      tmpdir(),
      `media-duration-${randomUUID()}${extensionFor(asset.contentType, asset.kind)}`,
    );
    try {
      await this.downloadToFile(signed.url, tempPath);
      return await this.ffprobeDurationSeconds(tempPath);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async downloadToFile(url: string, destPath: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_DURATION_DOWNLOAD_FAILED',
          message: `Failed to download media for duration probe (HTTP ${response.status}).`,
        });
      }
      const nodeStream = Readable.fromWeb(
        response.body as unknown as NodeReadableStream,
      );
      await pipeline(nodeStream, createWriteStream(destPath));
    } finally {
      clearTimeout(timer);
    }
  }

  private async ffprobeDurationSeconds(filePath: string): Promise<number> {
    const executable = process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe';
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath,
        ],
        {
          encoding: 'utf8',
          timeout: FFPROBE_TIMEOUT_MS,
          maxBuffer: FFPROBE_MAX_OUTPUT_BYTES,
        },
        (error, stdout) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          const systemError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals | null;
          };
          if (systemError.code === 'ENOENT') {
            reject(
              new ServiceUnavailableException({
                code: 'MEDIA_DURATION_PROBE_UNAVAILABLE',
                message:
                  'The server media inspector is unavailable. ffprobe must be installed.',
              }),
            );
            return;
          }
          if (systemError.killed || systemError.signal) {
            reject(
              new ServiceUnavailableException({
                code: 'MEDIA_DURATION_PROBE_TIMEOUT',
                message: 'The server timed out while measuring media duration.',
              }),
            );
            return;
          }
          reject(
            new UnprocessableEntityException({
              code: 'MEDIA_DURATION_PROBE_FAILED',
              message:
                'Could not measure media duration from the stored bytes.',
            }),
          );
        },
      );
    });

    const exact = Number(String(output).trim());
    if (!Number.isFinite(exact) || exact <= 0) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_DURATION_PROBE_FAILED',
        message: 'Could not measure media duration from the stored bytes.',
      });
    }
    // Keep sub-second precision for combined-duration rules (e.g. Seedance 15s).
    return exact;
  }
}

function extensionFor(
  contentType: string | null | undefined,
  kind: MediaAssetKind,
): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('quicktime') || ct.includes('mov')) return '.mov';
  if (ct.includes('webm')) return '.webm';
  if (ct.includes('mp4')) return '.mp4';
  if (ct.includes('mpeg') || ct.includes('mp3')) return '.mp3';
  if (ct.includes('wav')) return '.wav';
  return kind === MediaAssetKind.audio ? '.bin' : '.mp4';
}
