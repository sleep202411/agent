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
import {
  PlayableVideoProbeService,
  type PlayableVideoProbeResult,
} from '../media/playable-video-probe.service';

const SIGNED_READ_TTL_SECONDS = 60 * 60;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

export interface StoryUploadedVideoProbeAsset {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: bigint | null;
}

export interface StoryUploadedVideoProbeResult extends PlayableVideoProbeResult {
  checksumSha256: string;
  sizeBytes: bigint;
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
    private readonly videoProbe: PlayableVideoProbeService,
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
      const technical = await this.videoProbe.probeFile(tempFile, {
        requireBrowserSafeMp4: true,
      });
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

function invalidVideo(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_UPLOAD_INVALID',
    message: 'The uploaded file is not a readable video.',
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
