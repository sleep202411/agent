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
 *   IMM_PROJECT_NAME      — IMM project. Default "fizzdragon-cn".
 *   IMM_REGION            — bare region. Default "cn-hangzhou".
 *   IMM_ENDPOINT          — override. Default "https://imm.{region}.aliyuncs.com".
 *   IMM_ACCESS_KEY_ID/SECRET — fall back to OSS_ACCESS_KEY_ID/SECRET (same acct).
 *   IMM_SET_HLS_CACHE_CONTROL — "false" to skip the post-transcode Cache-Control
 *     pass on the produced objects. Default on.
 * OSS read-back reuses OSS_BUCKET / OSS_REGION / OSS_INTERNAL.
 */
import { Injectable, Logger } from '@nestjs/common';
import RPCClient from '@alicloud/pop-core';
import OSS from 'ali-oss';

export type ImmTaskState = 'running' | 'succeeded' | 'failed';

export interface ImmTaskStatus {
  state: ImmTaskState;
  raw: string;
  errorMessage?: string;
}

export interface ImmFinalizeResult {
  masterObjectKey: string;
  /** Number of media segments in the first rendition playlist. ≤1 means the
   *  source was degenerate (too short / truncated / corrupt) and the HLS must
   *  not be published — playback keeps the original mp4. */
  segmentCount: number;
  /**
   * EVERY object key the transcode produced — the master playlist, each
   * rendition playlist, and every media segment — resolved by parsing the
   * playlists themselves (exact set, no bucket listing, no guessed names).
   * The pipeline registers each as a MediaObjectPlacement so a moderation
   * takedown covers every physical HLS object, not just the master (closing
   * the "blocked HLS still streamable via rendition URLs" gap).
   */
  objectKeys: string[];
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

@Injectable()
export class ImmTranscodeService {
  private readonly logger = new Logger(ImmTranscodeService.name);
  private readonly imm: RPCClient | null;
  private readonly oss: OSS | null;
  private readonly bucket: string;

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
    const region = (process.env.IMM_REGION ?? 'cn-hangzhou').trim();
    const endpoint = (
      process.env.IMM_ENDPOINT ?? `https://imm.${region}.aliyuncs.com`
    ).trim();

    this.bucket = (process.env.OSS_BUCKET ?? '').trim();
    const ossRegion = (process.env.OSS_REGION ?? '').trim();

    if (!accessKeyId || !accessKeySecret) {
      this.logger.warn(
        'IMM_/OSS_ access keys absent — ImmTranscodeService is a no-op',
      );
      this.imm = null;
      this.oss = null;
      return;
    }

    this.imm = new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint,
      apiVersion: '2020-09-30',
    });

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
    return this.imm != null && this.oss != null;
  }

  /** HLS output prefix for an asset — `hls/{assetId}/`. */
  hlsPrefix(assetId: string): string {
    return `hls/${assetId}/`;
  }

  masterObjectKey(assetId: string): string {
    return `${this.hlsPrefix(assetId)}master.m3u8`;
  }

  private projectName(): string {
    return (process.env.IMM_PROJECT_NAME ?? 'fizzdragon-cn').trim();
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
        Targets: [
          this.rendition(prefix, 1080, 25),
          this.rendition(prefix, 720, 26),
          this.rendition(prefix, 480, 28),
        ],
      },
    ];

    const res = await this.imm.request<{
      TaskId?: string;
      Data?: { TaskId?: string };
      RequestId?: string;
    }>(
      'CreateMediaConvertTask',
      {
        ProjectName: this.projectName(),
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
    const res = await this.imm.request<{
      Status?: string;
      Task?: {
        Status?: string;
        Error?: { Message?: string };
        Message?: string;
      };
      Data?: { Status?: string; Task?: { Status?: string } };
      Error?: { Message?: string };
      Message?: string;
    }>(
      'GetTask',
      {
        // ProjectName is mandatory for GetTask too (verified against live IMM —
        // omitting it returns MissingProjectName), not just CreateMediaConvertTask.
        ProjectName: this.projectName(),
        TaskId: taskId,
        TaskType: 'MediaConvert',
      },
      { method: 'POST', formatParams: false, timeout: IMM_REQUEST_TIMEOUT_MS },
    );
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
    const errorMessage =
      res?.Error?.Message ??
      res?.Task?.Error?.Message ??
      res?.Task?.Message ??
      res?.Message;
    return { state: mapTaskState(raw), raw, errorMessage };
  }

  /**
   * Read the produced master + every rendition playlist to collect the exact
   * set of produced object keys and count segments, and (best-effort) set
   * Cache-Control on the HLS objects. Caller treats `segmentCount <= 1` as a
   * degenerate source and keeps the mp4. `segmentCount` is measured on the
   * FIRST rendition playlist (unchanged semantics); `objectKeys` covers ALL
   * renditions so the placement ledger — and therefore moderation takedown —
   * spans every physical object.
   */
  async finalizeHls(assetId: string): Promise<ImmFinalizeResult> {
    if (!this.oss) throw new Error('OSS read-back is not configured');
    const prefix = this.hlsPrefix(assetId);
    const masterKey = this.masterObjectKey(assetId);
    const master = await this.getText(masterKey);
    const childNames = playlistEntries(master).filter((entry) =>
      entry.endsWith('.m3u8'),
    );
    if (childNames.length === 0) {
      throw new Error(`HLS master has no rendition playlist: ${masterKey}`);
    }

    const objectKeys = new Set<string>([masterKey]);
    let segmentCount = 0;
    for (const [index, childName] of childNames.entries()) {
      const childKey = `${prefix}${childName}`;
      objectKeys.add(childKey);
      const child = await this.getText(childKey);
      const segments = playlistEntries(child).filter((entry) =>
        /\.ts(\?|$)/i.test(entry),
      );
      for (const segment of segments) {
        objectKeys.add(`${prefix}${stripQuery(segment)}`);
      }
      if (index === 0) segmentCount = segments.length;
    }

    if (
      segmentCount > 1 &&
      (process.env.IMM_SET_HLS_CACHE_CONTROL ?? '').trim().toLowerCase() !==
        'false'
    ) {
      await this.applyHlsCacheControl(assetId).catch((err) =>
        this.logger.warn(
          `HLS Cache-Control pass failed asset=${assetId}: ${errText(err)}`,
        ),
      );
    }

    return {
      masterObjectKey: masterKey,
      segmentCount,
      objectKeys: [...objectKeys],
    };
  }

  private rendition(prefix: string, height: number, crf: number) {
    return {
      URI: `${prefix}${height}p.m3u8`,
      Container: 'ts',
      Segment: { Format: 'hls', Duration: 6 },
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

  private async getText(key: string): Promise<string> {
    const res = await this.oss!.get(key);
    const content = (res as { content?: Buffer }).content;
    if (!content) {
      throw new Error(`OSS object has no content: ${key}`);
    }
    return content.toString('utf8');
  }

  /**
   * `.ts` segments are immutable → cache forever; playlists short. ali-oss
   * copies the object onto itself with `REPLACE` metadata directive. Per-object
   * failures are swallowed (caller wraps this in catch).
   */
  private async applyHlsCacheControl(assetId: string): Promise<void> {
    if (!this.oss) return;
    const prefix = this.hlsPrefix(assetId);
    let marker: string | undefined;
    do {
      const listed = await this.oss.list(
        { prefix, 'max-keys': 1000, marker },
        {},
      );
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
      marker = listed.nextMarker;
    } while (marker);
  }
}

/** Non-comment, non-blank lines of an m3u8 — the URI entries, in order.
 *  IMM writes RELATIVE entries (`480p.m3u8`, `480p-0.ts`) so each resolves
 *  against the asset's `hls/{assetId}/` prefix. */
function playlistEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** Object key of a playlist URI entry — drop any query string. */
function stripQuery(uri: string): string {
  const index = uri.indexOf('?');
  return index === -1 ? uri : uri.slice(0, index);
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

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
