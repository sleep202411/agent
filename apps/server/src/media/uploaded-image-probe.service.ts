import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  MediaStorageAccessService,
  type MediaStorageReadUrlResult,
} from '../infra/storage/media-storage-access.service';

const SIGNED_READ_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const IMAGE_INSPECT_TIMEOUT_MS = 60 * 1000;
const IMAGE_TOOL_MAX_OUTPUT_BYTES = 256 * 1024;
// Bound decoder allocation before ffmpeg sees attacker-controlled dimensions.
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 100_000_000;

export interface UploadedImageProbeAsset {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: bigint;
}

export interface UploadedImageProbeResult {
  checksumSha256: string;
  sizeBytes: bigint;
  width: number;
  height: number;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileExtension: 'jpg' | 'png' | 'webp';
}

interface ProbeOptions {
  expectedContentType: string;
  maxBytes: number;
}

/**
 * Reads a promoted, unsigned-final image back from managed storage and derives
 * every reusable technical field from those exact bytes. It streams SHA-256
 * while spooling, asks ffprobe for the byte-level codec/dimensions, then makes
 * ffmpeg decode every frame to a null sink. Client MIME, checksum, dimensions,
 * ETag, and response metadata are never accepted as image truth.
 */
@Injectable()
export class UploadedImageProbeService {
  constructor(private readonly storageAccess: MediaStorageAccessService) {}

  async probe(
    asset: UploadedImageProbeAsset,
    options: ProbeOptions,
  ): Promise<UploadedImageProbeResult> {
    const expectedSize = assertProbeableImage(asset, options.maxBytes);
    const expectedContentType = normalizeImageContentType(
      options.expectedContentType,
    );

    let signed: MediaStorageReadUrlResult;
    try {
      signed = await this.storageAccess.createReadUrl(asset, {
        expiresInSeconds: SIGNED_READ_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw imageStorageUnavailable();
    }
    if (
      signed.provider !== storageProviderId(asset.storageProvider) ||
      signed.bucket !== asset.bucket ||
      signed.objectKey !== asset.objectKey
    ) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_IMAGE_STORAGE_IDENTITY_MISMATCH',
        message: 'Media storage returned a different image object identity.',
      });
    }

    const tempFile = join(tmpdir(), `fizz-reference-image-${randomUUID()}`);
    try {
      const downloaded = await downloadAndHash(
        signed.url,
        tempFile,
        expectedSize,
        options.maxBytes,
      );
      const technical = await inspectImage(tempFile);
      assertSafeDimensions(technical.width, technical.height);
      await decodeEntireImage(tempFile);
      if (technical.contentType !== expectedContentType) {
        throw new UnprocessableEntityException({
          code: 'MEDIA_IMAGE_CONTENT_TYPE_MISMATCH',
          message: `The uploaded bytes are ${technical.contentType}, not ${expectedContentType}.`,
        });
      }
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
  maxBytes: number,
): Promise<{ checksumSha256: string; sizeBytes: number }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw imageStorageUnavailable();
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw imageStorageUnavailable();
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const headerSize = Number(declaredLength);
    if (!Number.isSafeInteger(headerSize) || headerSize !== expectedSize) {
      await response.body.cancel().catch(() => undefined);
      throw imageSizeMismatch(expectedSize, headerSize);
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
      if (sizeBytes > expectedSize || sizeBytes > maxBytes) {
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
      throw imageSizeMismatch(error.expected, error.actual);
    }
    throw imageStorageUnavailable();
  }
  if (sizeBytes !== expectedSize) {
    throw imageSizeMismatch(expectedSize, sizeBytes);
  }
  return { checksumSha256: hash.digest('hex'), sizeBytes };
}

export async function inspectImage(
  filePath: string,
): Promise<
  Pick<
    UploadedImageProbeResult,
    'contentType' | 'fileExtension' | 'width' | 'height'
  >
> {
  const executable = process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe';
  const output = await execImageTool(executable, [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height:format=format_name',
    '-of',
    'json',
    filePath,
  ]);
  let decoded: unknown;
  try {
    decoded = JSON.parse(output) as unknown;
  } catch {
    throw invalidImage();
  }
  const root = record(decoded);
  const format = record(root?.format);
  const formatName =
    typeof format?.format_name === 'string'
      ? format.format_name.trim().toLowerCase()
      : '';
  const streams = Array.isArray(root?.streams) ? root.streams : [];
  const stream = streams
    .map(record)
    .find((candidate) => candidate?.codec_type === 'video');
  if (!stream) throw invalidImage();
  const width = positiveInteger(stream.width);
  const height = positiveInteger(stream.height);
  const codec =
    typeof stream.codec_name === 'string'
      ? stream.codec_name.trim().toLowerCase()
      : '';
  if (!width || !height) throw invalidImage();

  if (
    (codec === 'png' || codec === 'apng') &&
    /(^|_)a?png(_|$)/.test(formatName)
  ) {
    return { contentType: 'image/png', fileExtension: 'png', width, height };
  }
  if (codec === 'mjpeg' && /(^|_)jpeg(_|$)/.test(formatName)) {
    return { contentType: 'image/jpeg', fileExtension: 'jpg', width, height };
  }
  if (codec === 'webp' && /(^|_)webp(_|$)/.test(formatName)) {
    return { contentType: 'image/webp', fileExtension: 'webp', width, height };
  }
  throw invalidImage();
}

/** Decode every frame; successful header parsing alone is insufficient. */
async function decodeEntireImage(filePath: string): Promise<void> {
  const executable = process.env.MEDIA_FFMPEG_PATH?.trim() || 'ffmpeg';
  await execImageTool(executable, [
    '-nostdin',
    '-hide_banner',
    '-v',
    'error',
    '-xerror',
    '-threads',
    '1',
    '-i',
    filePath,
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-',
  ]);
}

async function execImageTool(
  executable: string,
  args: string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: 'utf8',
        timeout: IMAGE_INSPECT_TIMEOUT_MS,
        maxBuffer: IMAGE_TOOL_MAX_OUTPUT_BYTES,
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
        if (systemError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(
            new ServiceUnavailableException({
              code: 'MEDIA_IMAGE_INSPECTOR_OUTPUT_LIMIT',
              message:
                'The server image inspector exceeded its output limit. The file has not been validated.',
            }),
          );
          return;
        }
        if (systemError.code === 'ENOENT') {
          reject(
            new ServiceUnavailableException({
              code: 'MEDIA_IMAGE_INSPECTOR_UNAVAILABLE',
              message:
                'The server image inspector is unavailable. ffprobe and ffmpeg must be installed.',
            }),
          );
          return;
        }
        if (systemError.killed || systemError.signal) {
          reject(
            new ServiceUnavailableException({
              code: 'MEDIA_IMAGE_INSPECTOR_TIMEOUT',
              message: 'The server timed out while inspecting the image.',
            }),
          );
          return;
        }
        reject(invalidImage());
      },
    );
  });
}

function assertSafeDimensions(width: number, height: number): void {
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_DIMENSIONS_UNSUPPORTED',
      message: `The uploaded image exceeds ${MAX_IMAGE_DIMENSION}px on one axis or ${MAX_IMAGE_PIXELS} total pixels.`,
    });
  }
}

function assertProbeableImage(
  asset: UploadedImageProbeAsset,
  maxBytes: number,
): number {
  if (
    asset.storageProvider === MediaStorageProvider.external_url ||
    !asset.bucket ||
    !asset.objectKey
  ) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_NOT_STORAGE_BACKED',
      message: 'The uploaded image is not backed by managed media storage.',
    });
  }
  if (
    asset.sizeBytes <= 0n ||
    asset.sizeBytes > BigInt(maxBytes) ||
    asset.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_SIZE_INVALID',
      message: `The uploaded image must be between 1 and ${maxBytes} bytes.`,
    });
  }
  return Number(asset.sizeBytes);
}

function normalizeImageContentType(
  value: string,
): UploadedImageProbeResult['contentType'] {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase();
  if (
    normalized !== 'image/jpeg' &&
    normalized !== 'image/png' &&
    normalized !== 'image/webp'
  ) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_CONTENT_TYPE_INVALID',
      message:
        'The uploaded object does not have a supported image content type.',
    });
  }
  return normalized;
}

function storageProviderId(
  provider: MediaStorageProvider,
): 'azure_blob' | 'aliyun_oss' | 's3_compatible' {
  if (provider === MediaStorageProvider.azure_blob) return 'azure_blob';
  if (provider === MediaStorageProvider.aliyun_oss) return 'aliyun_oss';
  if (provider === MediaStorageProvider.s3_compatible) return 's3_compatible';
  throw new UnprocessableEntityException({
    code: 'MEDIA_IMAGE_NOT_STORAGE_BACKED',
    message: 'The uploaded image is not backed by managed media storage.',
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function invalidImage(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'MEDIA_IMAGE_INVALID',
    message:
      'The uploaded file is not a complete, decodable JPEG, PNG, or WebP image.',
  });
}

function imageSizeMismatch(
  expected: number,
  actual: number,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'MEDIA_IMAGE_SIZE_MISMATCH',
    message: `The stored image size changed (expected ${expected} bytes, received ${actual}).`,
  });
}

function imageStorageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'MEDIA_IMAGE_STORAGE_UNAVAILABLE',
    message: 'The uploaded image could not be downloaded for inspection.',
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
