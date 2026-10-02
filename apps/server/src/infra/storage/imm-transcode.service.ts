/**
 * Alibaba Cloud IMM (Intelligent Media Management) transcode driver — the CN
 * provider that turns an uploaded source video into ABR HLS. IMM runs the
 * encode on Alibaba's compute (`CreateMediaConvertTask`, async); our side only
 * submits, polls (`GetTask`), and reads the produced playlist back from OSS.
 *
 * This is OSS/CN only. Azure (.com) has no first-party managed encoder; a
 * future `FfmpegTranscoder`/partner path would implement the same shape
 * (submit → poll → finalize) without the job framework or playback resolver
 * changing. The worker never enqueues transcode for non-`aliyun_oss` assets, so
 * an unconfigured IMM on .com simply never runs.
 *
 * The request payload mirrors the EXACT, hand-validated CLI invocation that
 * produced correct multi-segment ABR output (see memory
 * `project_cn_video_hls_transcode`): three renditions, CRF 25/26/28,
 * `ResolutionOption: adaptive` with an `x{height}` drive, `FrameRateOption:
 * adaptive`, `PixelFormat: yuv420p`, 6s HLS segments. We send it via
 * `@alicloud/pop-core` (raw RPC, `Sources`/`TargetGroups` as JSON strings, which
 * is how the IMM API and the CLI both accept them) rather than the typed SDK,
 * whose 4.6.x model is a flatter shape that risks silently dropping these
 * fields — the precise bug ("only 1 segment / wrong codec") we already hit once.
 *
 * Config (env):
 *   IMM_PROJECT_NAME      — IMM project. Required on the CN cell (no default).
 *   IMM_REGION            — bare region, e.g. cn-hangzhou. Required on the CN
 *                           cell (no default).
 *   IMM_ENDPOINT          — override. Default "https://imm.{region}.aliyuncs.com".
 *   IMM_ACCESS_KEY_ID/SECRET — fall back to OSS_ACCESS_KEY_ID/SECRET (same acct).
 *   IMM_SET_HLS_CACHE_CONTROL — "false" to skip the post-transcode Cache-Control
 *     pass on the produced objects. Default on.
 *   IMM_MAX_MINUTES       — wall-clock ceiling of one transcode (default 30).
 * OSS read-back reuses OSS_BUCKET / OSS_REGION / OSS_INTERNAL. The CN cell
 * asserts the whole set at boot ({@link ImmTranscodeService.assertConfigured});
 * the service itself stays constructible without it so .com and tests boot.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RPCClient } from '@alicloud/pop-core';
import OSS from 'ali-oss';
import { z } from 'zod';

export type ImmTaskState = 'running' | 'succeeded' | 'failed';

export interface ImmTaskStatus {
  state: ImmTaskState;
  raw: string;
  /** IMM's own error code for a failed task (e.g. `InvalidParameter`). */
  errorCode?: string;
  errorMessage?: string;
}

/** HLS segment target duration requested from IMM, in seconds. */
export const IMM_HLS_SEGMENT_SECONDS = 6;

/**
 * The ABR ladder IMM produces, top tier first. `name` is the rendition
 * playlist's file name (`{name}.m3u8`), which is how finalize and the admin
 * page identify a tier.
 */
export const IMM_HLS_LADDER = [
  { name: '1080p', height: 1080, crf: 25 },
  { name: '720p', height: 720, crf: 26 },
  { name: '480p', height: 480, crf: 28 },
] as const;

/** Ceiling on total IMM transcode wall time before the job is failed. */
export function immMaxMinutes(): number {
  return positiveInt(process.env.IMM_MAX_MINUTES, 30);
}

export interface ImmRenditionOutput {
  /** Playlist file name without `.m3u8`, e.g. `1080p`. */
  name: string;
  playlistKey: string;
  /** Actual tier size from the master's `EXT-X-STREAM-INF` RESOLUTION. */
  width: number | null;
  height: number | null;
  segmentCount: number;
  /** Sum of the playlist's `#EXTINF` durations. */
  durationSeconds: number;
  /** Longest single `#EXTINF` duration (0 with no segments). */
  maxSegmentSeconds: number;
}

export interface ImmFinalizeResult {
  masterObjectKey: string;
  /**
   * EVERY object key the playlists reference — the master playlist, each
   * rendition playlist, and every media segment — resolved by parsing the
   * playlists themselves. The pipeline registers each as a
   * MediaObjectPlacement, so the placement ledger names every published
   * object.
   */
  objectKeys: string[];
  /** Rendition playlists in master order (the top tier first). */
  renditions: ImmRenditionOutput[];
  /** Sum of the sizes of ALL objects listed under the asset's HLS prefix. */
  totalBytes: bigint;
  /** Referenced keys that are absent from the prefix listing. */
  missingKeys: string[];
}

const ossInternal = (): boolean =>
  ['1', 'true', 'yes', 'on'].includes(
    (process.env.OSS_INTERNAL ?? '').trim().toLowerCase(),
  );

// Hard per-call timeouts. The media worker drains SEQUENTIALLY and single-flight,
// so a hung IMM RPC or OSS read would otherwise wedge ALL media jobs (transcode
// polls, placement backfills, takedowns) until the socket finally resolves.
const IMM_REQUEST_TIMEOUT_MS = 30_000;
const OSS_OP_TIMEOUT_MS = 60_000;
/** OSS ListObjects / DeleteMultipleObjects page size (the API maximum). */
const OSS_PAGE_SIZE = 1000;
/**
 * Upper bound on objects one {@link ImmTranscodeService.deleteHlsOutput} call
 * may delete. A real output is a few hundred objects (a 230 s source produced
 * 121); a listing that keeps returning keys past this is a runaway, not a
 * prefix to empty.
 */
const HLS_PREFIX_MAX_OBJECTS = 20_000;

// IMM 2020-09-30 task statuses we understand. Anything else is logged loudly
// (contract drift) rather than silently treated as "still running".
const RECOGNISED_STATUSES = new Set([
  'Succeeded',
  'Failed',
  'Cancelled',
  'Running',
  'Queuing',
  'Pending',
  'Init',
]);

interface GetTaskBody {
  Status?: string;
  Code?: string;
  Message?: string;
  Task?: {
    Status?: string;
    Code?: string;
    Error?: { Message?: string };
    Message?: string;
  };
  Data?: { Status?: string; Task?: { Status?: string } };
  Error?: { Code?: string; Message?: string };
}

@Injectable()
export class ImmTranscodeService {
  private readonly logger = new Logger(ImmTranscodeService.name);
  private readonly imm: RPCClient | null;
  private readonly oss: OSS | null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly projectName: string;
  private readonly missingConfigurationKeys: string[];

  constructor() {
    const accessKeyId = (
      process.env.IMM_ACCESS_KEY_ID ??
      process.env.OSS_ACCESS_KEY_ID ??
      ''
    ).trim();
    const accessKeySecret = (
      process.env.IMM_ACCESS_KEY_SECRET ??
      process.env.OSS_ACCESS_KEY_SECRET ??
      ''
    ).trim();
    this.region = (process.env.IMM_REGION ?? '').trim();
    this.projectName = (process.env.IMM_PROJECT_NAME ?? '').trim();
    const endpoint = (
      process.env.IMM_ENDPOINT ??
      (this.region ? `https://imm.${this.region}.aliyuncs.com` : '')
    ).trim();

    this.bucket = (process.env.OSS_BUCKET ?? '').trim();
    const ossRegion = (process.env.OSS_REGION ?? '').trim();

    this.missingConfigurationKeys = [
      ...(this.region ? [] : ['IMM_REGION']),
      ...(this.projectName ? [] : ['IMM_PROJECT_NAME']),
      ...(accessKeyId ? [] : ['IMM_ACCESS_KEY_ID|OSS_ACCESS_KEY_ID']),
      ...(accessKeySecret
        ? []
        : ['IMM_ACCESS_KEY_SECRET|OSS_ACCESS_KEY_SECRET']),
      ...(this.bucket ? [] : ['OSS_BUCKET']),
      ...(ossRegion ? [] : ['OSS_REGION']),
    ];

    if (!accessKeyId || !accessKeySecret) {
      this.logger.warn(
        'IMM_/OSS_ access keys absent — ImmTranscodeService is a no-op',
      );
      this.imm = null;
      this.oss = null;
      return;
    }

    // Without a region (or an explicit endpoint) there is no IMM host to talk
    // to; isConfigured() stays false and the CN boot assertion names it.
    this.imm = endpoint
      ? new RPCClient({
          accessKeyId,
          accessKeySecret,
          endpoint,
          apiVersion: '2020-09-30',
        })
      : null;

    this.oss =
      this.bucket && ossRegion
        ? new OSS({
            region: ossRegion,
            bucket: this.bucket,
            accessKeyId,
            accessKeySecret,
            secure: true,
            internal: ossInternal(),
            authorizationV4: true,
            timeout: OSS_OP_TIMEOUT_MS,
          })
        : null;
  }

  /** True when IMM + OSS read-back are both configured (i.e. the CN cell). */
  isConfigured(): boolean {
    return (
      this.imm != null &&
      this.oss != null &&
      this.region.length > 0 &&
      this.projectName.length > 0
    );
  }

  /**
   * Fail loud when a cell that depends on IMM transcoding lacks any part of its
   * configuration. Names every missing variable at once.
   */
  assertConfigured(context: string): void {
    if (this.missingConfigurationKeys.length > 0) {
      throw new Error(
        `${context} requires: ${this.missingConfigurationKeys.join(', ')}`,
      );
    }
  }

  /** The OSS bucket the read-back (and HLS cleanup) client is bound to. */
  ossBucket(): string {
    return this.bucket;
  }

  /** HLS output prefix for an asset — `hls/{assetId}/`. */
  hlsPrefix(assetId: string): string {
    return `hls/${assetId}/`;
  }

  masterObjectKey(assetId: string): string {
    return `${this.hlsPrefix(assetId)}master.m3u8`;
  }

  /**
   * Submit the ABR-HLS transcode. Returns the IMM TaskId to poll. Output lands
   * at `hls/{assetId}/` (master + per-rendition playlists + `{h}p-{n}.ts`).
   */
  async submitHlsTask(
    assetId: string,
    bucket: string,
    objectKey: string,
  ): Promise<string> {
    if (!this.imm) throw new Error('IMM is not configured');
    const prefix = `oss://${bucket}/${this.hlsPrefix(assetId)}`;

    const sources = [{ URI: `oss://${bucket}/${objectKey}` }];
    const targetGroups = [
      {
        URI: `${prefix}master.m3u8`,
        Targets: IMM_HLS_LADDER.map((tier) =>
          this.rendition(prefix, tier.height, tier.crf),
        ),
      },
    ];

    const res = await this.imm.request<{
      TaskId?: string;
      Data?: { TaskId?: string };
      RequestId?: string;
    }>(
      'CreateMediaConvertTask',
      {
        ProjectName: this.projectName,
        Sources: JSON.stringify(sources),
        TargetGroups: JSON.stringify(targetGroups),
      },
      { method: 'POST', formatParams: false, timeout: IMM_REQUEST_TIMEOUT_MS },
    );
    const taskId = res?.TaskId ?? res?.Data?.TaskId;
    if (!taskId) {
      throw new Error(
        `IMM CreateMediaConvertTask returned no TaskId (req=${res?.RequestId ?? '?'}, body=${JSON.stringify(res).slice(0, 500)})`,
      );
    }
    return taskId;
  }

  /** Poll a MediaConvert task. `Status` is top-level on the GetTask body. */
  async getTaskStatus(taskId: string): Promise<ImmTaskStatus> {
    if (!this.imm) throw new Error('IMM is not configured');
    let res: GetTaskBody;
    try {
      res = await this.imm.request<GetTaskBody>(
        'GetTask',
        {
          // ProjectName is mandatory for GetTask too (verified against live IMM —
          // omitting it returns MissingProjectName), not just CreateMediaConvertTask.
          ProjectName: this.projectName,
          TaskId: taskId,
          TaskType: 'MediaConvert',
        },
        {
          method: 'POST',
          formatParams: false,
          timeout: IMM_REQUEST_TIMEOUT_MS,
        },
      );
    } catch (err) {
      // pop-core throws whenever a body carries a non-success top-level `Code`,
      // and GetTask reports a FAILED task's error in exactly that field. A body
      // that still carries the task `Status` is a successful poll of a failed
      // task, not a transport error — read it instead of retrying the poll.
      const body = (err as { data?: unknown }).data;
      if (!isGetTaskBody(body)) throw err;
      res = body;
    }
    const raw = (
      res?.Status ??
      res?.Task?.Status ??
      res?.Data?.Status ??
      res?.Data?.Task?.Status ??
      'Unknown'
    ).toString();
    // Surface a contract drift LOUDLY. mapTaskState defaults unknown → running,
    // which without this warning would look like an eternal in-progress task and
    // silently never publish HLS. Logging the raw body makes the real envelope
    // visible the first time it's polled.
    if (!RECOGNISED_STATUSES.has(raw)) {
      this.logger.warn(
        `IMM GetTask unrecognised status "${raw}" (task=${taskId}); raw=${JSON.stringify(res).slice(0, 1000)}`,
      );
    }
    const errorCode = nonEmpty(
      res?.Code ?? res?.Task?.Code ?? res?.Error?.Code,
    );
    const errorMessage = nonEmpty(
      res?.Error?.Message ??
        res?.Task?.Error?.Message ??
        res?.Task?.Message ??
        res?.Message,
    );
    return {
      state: mapTaskState(raw),
      raw,
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  /**
   * Read the produced master + every rendition playlist back from OSS and
   * measure the output: each tier's actual size (master `RESOLUTION`), segment
   * count and durations (`#EXTINF`), the exact set of referenced keys, and —
   * from one listing of the prefix — the total stored bytes and any referenced
   * key that is missing. Judging the result (degenerate or publishable) is the
   * caller's job; this never throws for a bad-but-readable output.
   */
  async finalizeHls(assetId: string): Promise<ImmFinalizeResult> {
    if (!this.oss) throw new Error('OSS read-back is not configured');
    const prefix = this.hlsPrefix(assetId);
    const masterKey = this.masterObjectKey(assetId);
    const master = parseMasterPlaylist(await this.getText(masterKey));

    const objectKeys = new Set<string>([masterKey]);
    const renditions: ImmRenditionOutput[] = [];
    for (const entry of master) {
      const playlistKey = `${prefix}${stripQuery(entry.uri)}`;
      objectKeys.add(playlistKey);
      const segments = parseMediaPlaylist(await this.getText(playlistKey));
      for (const segment of segments) {
        objectKeys.add(`${prefix}${stripQuery(segment.uri)}`);
      }
      renditions.push({
        name: renditionName(entry.uri),
        playlistKey,
        width: entry.width,
        height: entry.height,
        segmentCount: segments.length,
        durationSeconds: segments.reduce(
          (total, segment) => total + segment.durationSeconds,
          0,
        ),
        maxSegmentSeconds: segments.reduce(
          (max, segment) => Math.max(max, segment.durationSeconds),
          0,
        ),
      });
    }

    const listed = new Set<string>();
    let totalBytes = 0n;
    let marker: string | undefined;
    do {
      const page = await this.listPage(prefix, marker);
      for (const object of page.objects ?? []) {
        listed.add(object.name);
        totalBytes += BigInt(object.size ?? 0);
      }
      marker =
        page.isTruncated && page.nextMarker ? page.nextMarker : undefined;
    } while (marker);

    return {
      masterObjectKey: masterKey,
      objectKeys: [...objectKeys],
      renditions,
      totalBytes,
      missingKeys: [...objectKeys].filter((key) => !listed.has(key)),
    };
  }

  /**
   * `.ts` segments are immutable → cache forever; playlists short. ali-oss
   * copies the object onto itself with `REPLACE` metadata directive. Per-object
   * failures are swallowed (caller wraps this in catch). Run only on an output
   * that is about to be published; `IMM_SET_HLS_CACHE_CONTROL=false` skips it.
   */
  async applyHlsCacheControl(assetId: string): Promise<void> {
    if (!this.oss) return;
    if (
      (process.env.IMM_SET_HLS_CACHE_CONTROL ?? '').trim().toLowerCase() ===
      'false'
    ) {
      return;
    }
    const prefix = this.hlsPrefix(assetId);
    let marker: string | undefined;
    do {
      const listed = await this.listPage(prefix, marker);
      for (const obj of listed.objects ?? []) {
        const key = obj.name;
        const isTs = key.endsWith('.ts');
        await this.oss
          .copy(key, key, {
            headers: {
              'Cache-Control': isTs
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=60',
              // REPLACE wipes ALL metadata not re-supplied here, so Content-Type
              // MUST be re-set or the manifests/segments fall back to
              // octet-stream and strict players/CDNs reject them (mirrors
              // AzureBlobStorageService.setCacheControl preserving contentType).
              'Content-Type': isTs
                ? 'video/MP2T'
                : 'application/vnd.apple.mpegurl',
              'x-oss-metadata-directive': 'REPLACE',
            },
          })
          .catch(() => undefined);
      }
      marker =
        listed.isTruncated && listed.nextMarker ? listed.nextMarker : undefined;
    } while (marker);
  }

  /**
   * Delete every object under the asset's `hls/{assetId}/` prefix. Each round
   * lists from the start of the prefix (deleted keys never come back, so no
   * marker is needed) and deletes that page, until a listing comes back empty
   * (`complete: true`) or `deadline` (epoch ms) passes (`complete: false`; the
   * caller resumes later). Refuses anything but a UUID asset id in the bucket
   * this client is bound to, and any listed key outside the prefix.
   */
  async deleteHlsOutput(
    assetId: string,
    bucket: string,
    deadline: number,
  ): Promise<{ deleted: number; complete: boolean }> {
    if (!z.uuid().safeParse(assetId).success) {
      throw new Error(
        `Refusing to delete HLS output: asset id "${assetId}" is not a UUID.`,
      );
    }
    if (!this.oss) throw new Error('OSS read-back is not configured');
    if (bucket !== this.bucket) {
      throw new Error(
        `Refusing to delete HLS output in bucket "${bucket}": the OSS client is bound to "${this.bucket}".`,
      );
    }
    const prefix = this.hlsPrefix(assetId);
    let deleted = 0;
    for (;;) {
      const page = await this.listPage(prefix);
      const names = (page.objects ?? []).map((object) => object.name);
      if (names.length === 0) return { deleted, complete: true };
      const foreign = names.find((name) => !name.startsWith(prefix));
      if (foreign !== undefined) {
        throw new Error(
          `Refusing to delete HLS output: listing ${prefix} returned ${foreign}.`,
        );
      }
      if (deleted + names.length > HLS_PREFIX_MAX_OBJECTS) {
        throw new Error(
          `HLS prefix ${prefix} exceeds ${HLS_PREFIX_MAX_OBJECTS} objects`,
        );
      }
      await this.oss.deleteMulti(names, {
        quiet: true,
        timeout: OSS_OP_TIMEOUT_MS,
      });
      deleted += names.length;
      if (Date.now() > deadline) return { deleted, complete: false };
    }
  }

  private rendition(prefix: string, height: number, crf: number) {
    return {
      URI: `${prefix}${height}p.m3u8`,
      Container: 'ts',
      Segment: { Format: 'hls', Duration: IMM_HLS_SEGMENT_SECONDS },
      Video: {
        TranscodeVideo: {
          Codec: 'h264',
          Resolution: `x${height}`,
          ResolutionOption: 'adaptive',
          AdaptiveResolutionDirection: true,
          CRF: crf,
          FrameRate: 30,
          FrameRateOption: 'adaptive',
          PixelFormat: 'yuv420p',
          ScaleType: 'fit',
        },
      },
      Audio: {
        TranscodeAudio: {
          Codec: 'aac',
          Bitrate: 128000,
          Channel: 2,
          SampleRate: 44100,
        },
      },
    };
  }

  /**
   * One page of a prefix listing. The marker is omitted, never passed as
   * `undefined`: under V4 signing ali-oss signs the undefined query value but
   * leaves it out of the URL, and OSS answers SignatureDoesNotMatch.
   */
  private listPage(prefix: string, marker?: string) {
    return this.oss!.list(
      {
        prefix,
        'max-keys': OSS_PAGE_SIZE,
        ...(marker === undefined ? {} : { marker }),
      },
      { timeout: OSS_OP_TIMEOUT_MS },
    );
  }

  private async getText(key: string): Promise<string> {
    const res = await this.oss!.get(key);
    const content = (res as { content?: Buffer }).content;
    if (!content) {
      throw new Error(`OSS object has no content: ${key}`);
    }
    return content.toString('utf8');
  }
}

/**
 * Rendition entries of a master playlist, in order. Each `.m3u8` URI line is
 * paired with the `RESOLUTION=WxH` of the `#EXT-X-STREAM-INF` tag before it.
 * IMM writes RELATIVE entries (`480p.m3u8`), resolved against the prefix.
 */
function parseMasterPlaylist(
  text: string,
): Array<{ uri: string; width: number | null; height: number | null }> {
  const entries: Array<{
    uri: string;
    width: number | null;
    height: number | null;
  }> = [];
  let pending: { width: number; height: number } | null = null;
  for (const line of playlistLines(text)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const match = /(?:^|[:,])RESOLUTION=(\d+)x(\d+)/i.exec(line);
      pending = match
        ? { width: Number(match[1]), height: Number(match[2]) }
        : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (/\.m3u8(\?|$)/i.test(line)) {
      entries.push({
        uri: line,
        width: positiveOrNull(pending?.width),
        height: positiveOrNull(pending?.height),
      });
    }
    pending = null;
  }
  return entries;
}

/**
 * Media segments of a rendition playlist, in order: every URI line, with the
 * duration of the `#EXTINF:<seconds>,` tag before it (0 when absent).
 */
function parseMediaPlaylist(
  text: string,
): Array<{ uri: string; durationSeconds: number }> {
  const segments: Array<{ uri: string; durationSeconds: number }> = [];
  let duration: number | null = null;
  for (const line of playlistLines(text)) {
    if (line.startsWith('#EXTINF:')) {
      const seconds = Number.parseFloat(line.slice('#EXTINF:'.length));
      duration = Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push({ uri: line, durationSeconds: duration ?? 0 });
    duration = null;
  }
  return segments;
}

function playlistLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `sub/1080p.m3u8?x=1` → `1080p`. */
function renditionName(uri: string): string {
  const file = stripQuery(uri).split('/').pop() ?? uri;
  return file.replace(/\.m3u8$/i, '');
}

/** Object key of a playlist URI entry — drop any query string. */
function stripQuery(uri: string): string {
  const index = uri.indexOf('?');
  return index === -1 ? uri : uri.slice(0, index);
}

function positiveOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function isGetTaskBody(value: unknown): value is GetTaskBody {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as GetTaskBody).Status === 'string'
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mapTaskState(status: string): ImmTaskState {
  switch (status) {
    case 'Succeeded':
      return 'succeeded';
    case 'Failed':
    case 'Cancelled':
      return 'failed';
    default:
      // Queuing / Running / Pending / Unknown — keep polling.
      return 'running';
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
