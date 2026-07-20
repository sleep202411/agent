import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import {
  MediaStorageAccessService,
  type MediaStorageReadUrlResult,
} from '../infra/storage/media-storage-access.service';
import {
  STORY_CLIP_VIDEO_CONTENT_TYPE,
  STORY_CLIP_VIDEO_MAX_BYTES,
} from '../media/media-upload.policy';

const SIGNED_READ_TTL_SECONDS = 60 * 60;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 60 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;
const MP4_FORMAT_NAMES = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']);
const MP4_MAJOR_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso8',
  'iso9',
  'avc1',
  'mp41',
  'mp42',
  'm4v',
  'dash',
  'cmfc',
  'cmfs',
  'cmfv',
  '3gp4',
  '3gp5',
  '3gp6',
  '3gp7',
  '3g2a',
  '3g2b',
  '3g2c',
  'f4v',
  'msnv',
]);
const BROWSER_SAFE_H264_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const BROWSER_SAFE_H264_PROFILES = new Set([
  'baseline',
  'constrained baseline',
  'main',
  'high',
]);
const MAX_BROWSER_SAFE_H264_LEVEL = 52;

export interface StoryUploadedVideoProbeAsset {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: bigint | null;
}

export interface StoryUploadedVideoProbeResult {
  checksumSha256: string;
  sizeBytes: bigint;
  width: number;
  height: number;
  durationSeconds: number;
  durationSecondsExact: number;
}

@Injectable()
export class StoryFfprobeRunner {
  async run(filePath: string): Promise<string> {
    const executable = process.env.STORY_FFPROBE_PATH?.trim() || 'ffprobe';
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,profile,level,pix_fmt,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=format_name,duration:format_tags=major_brand',
          '-of',
          'json',
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
                code: 'STORY_VIDEO_PROBE_UNAVAILABLE',
                message:
                  'The server video inspector is unavailable. ffprobe must be installed.',
              }),
            );
            return;
          }
          if (systemError.killed || systemError.signal) {
            reject(
              new ServiceUnavailableException({
                code: 'STORY_VIDEO_PROBE_TIMEOUT',
                message: 'The server timed out while inspecting the video.',
              }),
            );
            return;
          }
          reject(invalidVideo());
        },
      );
    });
  }
}

/**
 * Turns a direct-to-storage upload into server-trusted technical metadata.
 * The browser never supplies a checksum, dimensions, or duration: the server
 * mints its own read URL, streams the exact confirmed object to a private temp
 * file, hashes those bytes, and runs ffprobe against that file.
 */
@Injectable()
export class StoryUploadedVideoProbeService {
  constructor(
    private readonly storageAccess: MediaStorageAccessService,
    private readonly ffprobe: StoryFfprobeRunner,
  ) {}

  async probe(
    asset: StoryUploadedVideoProbeAsset,
  ): Promise<StoryUploadedVideoProbeResult> {
    const expectedSize = assertProbeableAsset(asset);

    let signed: MediaStorageReadUrlResult;
    try {
      signed = await this.storageAccess.createReadUrl(asset, {
        expiresInSeconds: SIGNED_READ_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({
        code: 'STORY_VIDEO_STORAGE_UNAVAILABLE',
        message: 'The uploaded video could not be read from media storage.',
      });
    }
    if (
      signed.bucket !== asset.bucket ||
      signed.objectKey !== asset.objectKey
    ) {
      throw new ServiceUnavailableException({
        code: 'STORY_VIDEO_STORAGE_IDENTITY_MISMATCH',
        message: 'Media storage returned a different video object identity.',
      });
    }

    const tempFile = join(tmpdir(), `fizz-story-video-${randomUUID()}.upload`);
    try {
      const downloaded = await downloadAndHash(
        signed.url,
        tempFile,
        expectedSize,
      );
      const probeOutput = await this.ffprobe.run(tempFile);
      const technical = parseStoryVideoFfprobeOutput(probeOutput);
      return {
        checksumSha256: downloaded.checksumSha256,
        sizeBytes: BigInt(downloaded.sizeBytes),
        ...technical,
      };
    } finally {
      await unlink(tempFile).catch(() => undefined);
    }
  }
}

async function downloadAndHash(
  url: string,
  filePath: string,
  expectedSize: number,
): Promise<{ checksumSha256: string; sizeBytes: number }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceUnavailableException({
      code: 'STORY_VIDEO_STORAGE_UNAVAILABLE',
      message: 'The uploaded video could not be downloaded for inspection.',
    });
  }
  if (!response.ok || !response.body) {
    throw new ServiceUnavailableException({
      code: 'STORY_VIDEO_STORAGE_UNAVAILABLE',
      message: 'The uploaded video could not be downloaded for inspection.',
    });
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const headerSize = Number(declaredLength);
    if (!Number.isSafeInteger(headerSize) || headerSize !== expectedSize) {
      throw uploadSizeMismatch(expectedSize, headerSize);
    }
  }

  const hash = createHash('sha256');
  let sizeBytes = 0;
  const meter = new Transform({
    transform(
      chunk: Buffer | Uint8Array,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      if (sizeBytes > expectedSize) {
        callback(new DownloadSizeMismatchError(expectedSize, sizeBytes));
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>,
      ),
      meter,
      createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    if (error instanceof DownloadSizeMismatchError) {
      throw uploadSizeMismatch(error.expected, error.actual);
    }
    throw new ServiceUnavailableException({
      code: 'STORY_VIDEO_STORAGE_UNAVAILABLE',
      message: 'The uploaded video could not be downloaded for inspection.',
    });
  }

  if (sizeBytes !== expectedSize) {
    throw uploadSizeMismatch(expectedSize, sizeBytes);
  }
  return { checksumSha256: hash.digest('hex'), sizeBytes };
}

export function parseStoryVideoFfprobeOutput(output: string): {
  width: number;
  height: number;
  durationSeconds: number;
  durationSecondsExact: number;
} {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output) as unknown;
  } catch {
    throw invalidVideo();
  }
  const root = record(decoded);
  const streams = (Array.isArray(root?.streams) ? root.streams : [])
    .map(record)
    .filter((stream): stream is Record<string, unknown> => stream !== null);
  const stream =
    streams.find((candidate) => candidate.codec_type === 'video') ?? null;
  const format = record(root?.format);
  const formatNames =
    typeof format?.format_name === 'string'
      ? format.format_name.split(',').map((name) => name.trim().toLowerCase())
      : [];
  const formatTags = record(format?.tags);
  const majorBrand =
    typeof formatTags?.major_brand === 'string'
      ? formatTags.major_brand.trim().toLowerCase()
      : '';
  if (
    !formatNames.some((name) => MP4_FORMAT_NAMES.has(name)) ||
    !MP4_MAJOR_BRANDS.has(majorBrand)
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_UPLOAD_CONTAINER_UNSUPPORTED',
      message: 'The uploaded bytes must use a supported MP4 container brand.',
    });
  }
  if (!stream) throw invalidVideo();
  if (stream.codec_name !== 'h264') {
    throw unsupportedCodec('The video stream must use H.264.');
  }
  if (
    typeof stream.pix_fmt !== 'string' ||
    !BROWSER_SAFE_H264_PIXEL_FORMATS.has(stream.pix_fmt.toLowerCase())
  ) {
    throw unsupportedCodec(
      'The H.264 video stream must use the browser-safe yuv420p pixel format.',
    );
  }
  const profile =
    typeof stream.profile === 'string' ? stream.profile.toLowerCase() : '';
  const level = finiteNumber(stream.level);
  if (
    !BROWSER_SAFE_H264_PROFILES.has(profile) ||
    level === null ||
    !Number.isInteger(level) ||
    level < 10 ||
    level > MAX_BROWSER_SAFE_H264_LEVEL
  ) {
    throw unsupportedCodec(
      'The H.264 profile or level is not supported by the player.',
    );
  }
  const unsupportedAudio = streams.find(
    (candidate) =>
      candidate.codec_type === 'audio' && candidate.codec_name !== 'aac',
  );
  if (unsupportedAudio) {
    throw unsupportedCodec('Every audio stream must use AAC.');
  }
  const rawWidth = positiveInteger(stream?.width);
  const rawHeight = positiveInteger(stream?.height);
  const durationSecondsExact =
    positiveNumber(stream?.duration) ?? positiveNumber(format?.duration);
  if (!rawWidth || !rawHeight || !durationSecondsExact) {
    throw invalidVideo();
  }

  const rotation = readRotation(stream);
  const swapsAxes = rotation === 90 || rotation === 270;
  return {
    width: swapsAxes ? rawHeight : rawWidth,
    height: swapsAxes ? rawWidth : rawHeight,
    durationSeconds: Math.max(1, Math.round(durationSecondsExact)),
    durationSecondsExact,
  };
}

function assertProbeableAsset(asset: StoryUploadedVideoProbeAsset): number {
  if (
    asset.storageProvider === MediaStorageProvider.external_url ||
    !asset.bucket ||
    !asset.objectKey
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_UPLOAD_NOT_STORAGE_BACKED',
      message: 'The uploaded video is not backed by managed media storage.',
    });
  }
  if (asset.contentType.toLowerCase() !== STORY_CLIP_VIDEO_CONTENT_TYPE) {
    throw invalidVideo();
  }
  if (
    asset.sizeBytes === null ||
    asset.sizeBytes <= 0n ||
    asset.sizeBytes > BigInt(STORY_CLIP_VIDEO_MAX_BYTES)
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_UPLOAD_SIZE_INVALID',
      message: `The uploaded video must be between 1 and ${STORY_CLIP_VIDEO_MAX_BYTES} bytes.`,
    });
  }
  return Number(asset.sizeBytes);
}

function readRotation(stream: Record<string, unknown> | null): number {
  const sideData = Array.isArray(stream?.side_data_list)
    ? stream.side_data_list
    : [];
  const sideRotation = sideData
    .map(record)
    .find((item) => item && finiteNumber(item.rotation) !== null)?.rotation;
  const tags = record(stream?.tags);
  const value = finiteNumber(sideRotation ?? tags?.rotate) ?? 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && Number.isInteger(numeric) && numeric > 0
    ? numeric
    : null;
}

function invalidVideo(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_UPLOAD_INVALID',
    message: 'The uploaded file is not a readable video.',
  });
}

function unsupportedCodec(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_UPLOAD_CODEC_UNSUPPORTED',
    message,
  });
}

function uploadSizeMismatch(
  expected: number,
  actual: number,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_UPLOAD_SIZE_MISMATCH',
    message: `The stored video size changed (expected ${expected} bytes, received ${actual}).`,
  });
}

class DownloadSizeMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`expected ${expected} bytes, received at least ${actual}`);
  }
}
