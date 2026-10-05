import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import type { StoryboardSourceObject } from './authorized-storyboard';

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** Only call with the job's reauthorized canonical storage identities. Browser
 * URLs are never inputs. The renderer receives private local filenames only. */
export async function spoolStoryboard(
  sources: readonly StoryboardSourceObject[],
  storage: Pick<MediaStorageAccessService, 'createReadUrl'>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (!sources.length || sources.length > 100)
    throw new Error('Storyboard export requires between one and 100 clips.');
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'storyboard-input-'));
  const dispose = () => rm(directory, { recursive: true, force: true });
  const filenames: string[] = [];
  let total = 0;
  try {
    for (const [index, source] of sources.entries()) {
      signal.throwIfAborted();
      if (
        !['azure_blob', 'aliyun_oss', 's3_compatible'].includes(
          source.storageProvider,
        ) ||
        !source.bucket ||
        !source.objectKey ||
        !['video/mp4', 'video/webm'].includes(source.contentType)
      )
        throw new Error('Storyboard source is not a managed video.');
      const expected =
        source.sizeBytes === null ? null : Number(source.sizeBytes);
      if (
        expected !== null &&
        (!Number.isSafeInteger(expected) ||
          expected <= 0 ||
          expected > MAX_FILE_BYTES ||
          total + expected > MAX_TOTAL_BYTES)
      )
        throw new Error('Storyboard source exceeds the export size limit.');
      const signed = await storage.createReadUrl(
        { ...source, externalUrl: null },
        { expiresInSeconds: 300, cacheControl: 'private, no-store' },
      );
      const url = new URL(signed.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !signed.expiresAt ||
        !(Date.parse(signed.expiresAt) > Date.now())
      )
        throw new Error(
          'Storyboard storage did not return a valid private read URL.',
        );
      const deadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(5 * 60 * 1000),
      ]);
      const response = await fetcher(url, {
        signal: deadline,
        redirect: 'error',
        headers: { 'Accept-Encoding': 'identity' },
      });
      try {
        if (!response.ok || !response.body)
          throw new Error('Storyboard source download failed.');
        const encoding = response.headers.get('content-encoding');
        if (encoding && encoding !== 'identity')
          throw new Error('Storyboard source encoding is unsupported.');
        const rawLength = response.headers.get('content-length');
        const length = rawLength === null ? null : Number(rawLength);
        if (
          length !== null &&
          (!/^\d+$/.test(rawLength!) ||
            !Number.isSafeInteger(length) ||
            length <= 0 ||
            length > MAX_FILE_BYTES ||
            total + length > MAX_TOTAL_BYTES ||
            (expected !== null && length !== expected))
        )
          throw new Error(
            'Storyboard source size changed or exceeds the export limit.',
          );
        const filename = `input-${index}.${source.contentType === 'video/mp4' ? 'mp4' : 'webm'}`;
        const file = await open(join(directory, filename), 'wx', 0o600);
        let bytes = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            deadline.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            total += chunk.value.byteLength;
            if (
              bytes > MAX_FILE_BYTES ||
              total > MAX_TOTAL_BYTES ||
              (expected !== null && bytes > expected) ||
              (length !== null && bytes > length)
            )
              throw new Error(
                'Storyboard source exceeds its export size limit.',
              );
            // FileHandle.write can write fewer bytes than requested.
            let offset = 0;
            while (offset < chunk.value.byteLength) {
              const written = await file.write(
                chunk.value,
                offset,
                chunk.value.byteLength - offset,
              );
              if (!written.bytesWritten)
                throw new Error('Storyboard source could not be saved.');
              offset += written.bytesWritten;
            }
          }
          if (
            !bytes ||
            (expected !== null && bytes !== expected) ||
            (length !== null && bytes !== length)
          )
            throw new Error('Storyboard source download was incomplete.');
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
          await file.close();
        }
        filenames.push(filename);
      } finally {
        if (response.body && !response.body.locked)
          await response.body.cancel().catch(() => undefined);
      }
    }
    signal.throwIfAborted();
    return { directory, filenames, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
