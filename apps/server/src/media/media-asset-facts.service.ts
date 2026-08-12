/**
 * Server-trusted facts about a stored MediaAsset: duration and byte size.
 *
 * Client-reported values are never authority. `bytes` is read straight off the
 * asset row; `durationSeconds` is read when stored and otherwise measured by
 * ffprobe against a short-lived signed read URL and persisting the result.
 *
 * High-traffic design:
 * - DB hit is O(1) when duration already stored (steady-state generate path).
 * - Probe work is bounded per process (concurrency + wait queue) so a traffic
 *   spike cannot unbounded-spawn ffprobe and pin the pod.
 * - Same assetId is single-flighted (one probe shared by concurrent waiters).
 * - When the wait queue is full we shed load with 503 backpressure rather than
 *   melting the node; already-probed assets and pure text jobs are unaffected.
 * - Duration probe never spools the object onto local disk — episode videos
 *   are allowed up to EPISODE_VIDEO_MAX_BYTES (2 GiB); a full download would
 *   exhaust tmp under concurrent confirms.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaAssetKind, MediaStorageProvider } from '@prisma/client';
import { execFile } from 'node:child_process';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { EPISODE_VIDEO_MAX_BYTES } from './media-upload.policy';

/** Signed URL must outlive remote seeks on large MP4s (moov-at-end). */
const SIGNED_READ_TTL_SECONDS = 30 * 60;
/** Remote ffprobe: storage RTT + range seeks, not a local open. */
const FFPROBE_TIMEOUT_MS = 5 * 60 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 256 * 1024;
/**
 * Hard ceiling — must cover the largest video/audio upload contract
 * (`episode_video`). Larger objects are rejected before ffprobe runs.
 */
const MAX_PROBE_BYTES = EPISODE_VIDEO_MAX_BYTES;

/**
 * Simultaneous ffprobe operations per Node process.
 * Override with MEDIA_DURATION_PROBE_MAX_CONCURRENT (1–32).
 */
const DEFAULT_MAX_CONCURRENT = 4;
/**
 * Waiters allowed behind the concurrency cap. Beyond this we 503.
 * Override with MEDIA_DURATION_PROBE_MAX_QUEUE (0–256).
 */
const DEFAULT_MAX_QUEUE = 48;

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

/** Authoritative media facts for one asset. `null` means genuinely unknown. */
export interface MediaAssetFacts {
  durationSeconds: number | null;
  bytes: number | null;
}

@Injectable()
export class MediaAssetFactsService {
  private readonly logger = new Logger(MediaAssetFactsService.name);
  private readonly maxConcurrent = clampInt(
    process.env.MEDIA_DURATION_PROBE_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT,
    1,
    32,
  );
  private readonly maxQueue = clampInt(
    process.env.MEDIA_DURATION_PROBE_MAX_QUEUE,
    DEFAULT_MAX_QUEUE,
    0,
    256,
  );

  private activeProbes = 0;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  /** assetId → in-flight ensure promise (single-flight). */
  private readonly inflightByAssetId = new Map<
    string,
    Promise<number | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageAccess: MediaStorageAccessService,
  ) {
    this.logger.log(
      `duration probe pool maxConcurrent=${this.maxConcurrent} maxQueue=${this.maxQueue} maxBytes=${MAX_PROBE_BYTES}`,
    );
  }

  /**
   * Resolve facts for many assets. `bytes` comes from the asset row; duration
   * uses the stored value when present and otherwise probes storage, persists,
   * and returns it. Non video/audio assets simply have a null duration.
   *
   * Returns a map of assetId → facts for every asset that exists. Missing
   * durations are probed with concurrency limits + single-flight so parallel
   * submits for the same asset share one remote ffprobe.
   */
  async ensureFacts(
    assetIds: readonly string[],
  ): Promise<Map<string, MediaAssetFacts>> {
    const unique = [
      ...new Set(assetIds.map((id) => id.trim()).filter(Boolean)),
    ];
    const out = new Map<string, MediaAssetFacts>();
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

    const pending: Array<DurationProbeAsset & { id: string }> = [];
    for (const row of rows) {
      const stored = storedDuration(row.durationSeconds);
      out.set(row.id, {
        durationSeconds: stored,
        bytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
      });
      if (stored == null && DURATION_KINDS.has(row.kind)) pending.push(row);
    }

    if (pending.length === 0) return out;

    const results = await Promise.all(
      pending.map(async (row) => {
        try {
          const seconds = await this.ensureOne(row);
          return { id: row.id, seconds };
        } catch (err) {
          this.logger.warn(
            `duration probe failed asset=${row.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return { id: row.id, seconds: null as number | null };
        }
      }),
    );
    for (const { id, seconds } of results) {
      const facts = out.get(id);
      if (facts && seconds != null) facts.durationSeconds = seconds;
    }
    return out;
  }

  /**
   * Probe an object that is about to become a MediaAsset (confirm path).
   * Does not write DB — caller persists the returned seconds.
   * Shares the process probe pool so upload storms cannot fork-bomb ffprobe.
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
    return this.withProbeSlot(() => this.probeFromStorage(asset));
  }

  private ensureOne(
    row: DurationProbeAsset & { id: string },
  ): Promise<number | null> {
    const existing = this.inflightByAssetId.get(row.id);
    if (existing) return existing;

    const work = this.withProbeSlot(async () => {
      // Re-read under the slot: another worker may have persisted duration.
      const fresh = await this.prisma.mediaAsset.findFirst({
        where: { id: row.id, deletedAt: null },
        select: { durationSeconds: true },
      });
      const stored = storedDuration(fresh?.durationSeconds ?? null);
      if (stored != null) return stored;
      return this.probeAndPersist(row);
    }).finally(() => {
      this.inflightByAssetId.delete(row.id);
    });

    this.inflightByAssetId.set(row.id, work);
    return work;
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

  private async withProbeSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireProbeSlot();
    try {
      return await fn();
    } finally {
      this.releaseProbeSlot();
    }
  }

  private acquireProbeSlot(): Promise<void> {
    if (this.activeProbes < this.maxConcurrent) {
      this.activeProbes += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(
        new ServiceUnavailableException({
          code: 'MEDIA_DURATION_PROBE_BACKPRESSURE',
          message:
            'Media duration inspection is temporarily at capacity. Retry shortly.',
        }),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private releaseProbeSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      // Transfer the slot to the next waiter without decrementing active.
      next.resolve();
      return;
    }
    this.activeProbes = Math.max(0, this.activeProbes - 1);
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

    let signed: Awaited<ReturnType<MediaStorageAccessService['createReadUrl']>>;
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

    // Probe the object in place over HTTPS. ffprobe uses HTTP range requests
    // when the container supports them (OSS / Azure Blob do), so a 2 GiB
    // episode does not need a full local spool.
    return this.ffprobeDurationSeconds(signed.url);
  }

  private async ffprobeDurationSeconds(source: string): Promise<number> {
    const executable = process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe';
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        [
          '-v',
          'error',
          // Allow probing https signed URLs (default builds already include
          // these; explicit whitelist keeps restricted builds usable).
          '-protocol_whitelist',
          'file,http,https,tcp,tls,crypto',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          source,
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

/** A persisted duration counts as known only when finite and positive. */
function storedDuration(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
