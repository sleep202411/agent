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
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  return value;
}

async function inlineUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return url;
    const bytes = Number.parseInt(
      response.headers.get('content-length') ?? '',
      10,
    );
    if (Number.isFinite(bytes) && bytes > maxInlineBytes()) return url;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > maxInlineBytes()) {
      return url;
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
    return `data:${mime && mime.startsWith('image/') ? mime : 'image/png'};base64,${buffer.toString('base64')}`;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
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
