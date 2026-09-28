/**
 * Inlines image-reference URLs as base64 data URIs for Bailian requests.
 *
 * Why: Bailian's fetchers must otherwise download our reference URLs from the
 * media CDN over the public internet. That path is probabilistically flaky
 * (a single transient fetch failure was classified non-retryable and once
 * failed a whole sequential Story batch). The server itself downloads from
 * the same cloud reliably, and Bailian accepts data URIs for image inputs
 * (verified against wan2.7-image in production). Inlining removes their
 * downloader from the path entirely.
 *
 * Scope is deliberately narrow: image references only (`referenceImages`
 * items, `startFrame`, `endFrame`). Video references stay URL-based — their
 * byte sizes make inlining a bad trade. Every failure mode falls back to the
 * original URL (the previous behavior) instead of inventing new ones.
 */

const DOWNLOAD_TIMEOUT_MS = 10_000;

function inlineEnabled(): boolean {
  return process.env.BAILIAN_INLINE_REFERENCE_IMAGES !== 'false';
}

function maxInlineBytes(): number {
  const raw = Number.parseInt(process.env.BAILIAN_INLINE_MAX_BYTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 1024 * 1024;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const origins = new Set([
      'https://media.fizzdragon.com',
      'https://media.fizzspace.cn',
      'https://banner.fizzspace.cn',
    ]);
    for (const base of [
      process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS,
      process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE,
      process.env.MEDIA_PUBLIC_BASE_URL_AZURE_BLOB,
    ]) {
      if (!base) continue;
      try {
        origins.add(new URL(base).origin);
      } catch {
        /* Invalid optional origins cannot admit downloads. */
      }
    }
    return origins.has(url.origin) ? value : null;
  } catch {
    return null;
  }
}

async function inlineUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  const cancel = () => {
    void reader?.cancel().catch(() => {});
  };
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
    });
    if (controller.signal.aborted || !response.ok || !response.body) return url;
    const mime = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase();
    if (
      mime &&
      !mime.startsWith('image/') &&
      mime !== 'application/octet-stream' &&
      mime !== 'binary/octet-stream'
    )
      return url;
    const limit = maxInlineBytes();
    const bytes = Number.parseInt(
      response.headers.get('content-length') ?? '',
      10,
    );
    if (Number.isFinite(bytes) && bytes > limit) return url;
    reader = response.body.getReader();
    controller.signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) return url;
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > limit) return url;
      chunks.push(value);
    }
    if (!size) return url;
    const buffer = Buffer.concat(chunks, size);
    return `data:${mime && mime.startsWith('image/') ? mime : 'image/png'};base64,${buffer.toString('base64')}`;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', cancel);
    if (!complete) {
      if (reader) cancel();
      else void response?.body?.cancel().catch(() => {});
      controller.abort();
    }
    reader?.releaseLock();
  }
}

/** Mutates nothing; returns the input with image references inlined. */
export async function inlineBailianImageReferences(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!inlineEnabled()) return input;

  const referenceImages = Array.isArray(input.referenceImages)
    ? (input.referenceImages as unknown[])
    : null;

  const jobs: Array<Promise<unknown>> = [];
  const next: Record<string, unknown> = { ...input };

  if (referenceImages) {
    next.referenceImages = await Promise.all(
      referenceImages.map(async (item) => {
        if (!item || typeof item !== 'object') return item;
        const record = item as Record<string, unknown>;
        const url = httpsUrl(record.url);
        if (!url) return item;
        const declared =
          typeof record.bytes === 'number' && record.bytes > 0
            ? record.bytes
            : null;
        if (declared !== null && declared > maxInlineBytes()) return item;
        return { ...record, url: await inlineUrl(url) };
      }),
    );
  }

  for (const field of ['startFrame', 'endFrame'] as const) {
    const url = httpsUrl(input[field]);
    if (url)
      jobs.push(inlineUrl(url).then((inlined) => (next[field] = inlined)));
  }
  await Promise.all(jobs);

  return next;
}
