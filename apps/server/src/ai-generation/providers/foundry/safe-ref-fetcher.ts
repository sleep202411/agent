/**
 * Safe fetcher for user-supplied reference assets.
 *
 * Everything that flows through provider adapters as a reference URL
 * (image / video / audio for edit-style endpoints) is sourced from
 * client uploads, so it MUST be treated as adversarial input:
 *
 *   • SSRF guard      — only known public-CDN hosts are allowed; raw
 *                       IPs, private/link-local/loopback ranges, and
 *                       cloud metadata endpoints are rejected.
 *   • Size cap        — Content-Length is checked before draining the
 *                       body, and the streamed bytes are tallied so a
 *                       lying server can't pump unbounded memory.
 *   • Timeout         — an AbortController kills the request after a
 *                       fixed budget so the worker isn't pinned by a
 *                       slow remote.
 *   • MIME validation — only `image/*` responses are accepted (the
 *                       only file-ref type any current provider takes;
 *                       relax here when adding audio/video refs).
 *
 * Allowed hosts come from `REFERENCE_FETCH_ALLOWED_HOSTS` (comma list,
 * each item is matched as a suffix on the URL's hostname). If unset,
 * a small default list covers the buckets the app ships with today.
 * `localhost` is always allowed when `NODE_ENV !== 'production'`.
 */
import { Logger } from '@nestjs/common';
import net from 'node:net';

const log = new Logger('SafeRefFetcher');

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME_PREFIX = 'image/';

const DEFAULT_HOST_SUFFIXES = [
  // Aliyun OSS (banner / user / studio buckets across regions)
  '.aliyuncs.com',
  // Azure Blob + Azure CDN
  '.blob.core.windows.net',
  '.azureedge.net',
];

function getAllowedHostSuffixes(): string[] {
  const fromEnv = process.env.REFERENCE_FETCH_ALLOWED_HOSTS;
  if (!fromEnv) return DEFAULT_HOST_SUFFIXES;
  const parsed = fromEnv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_HOST_SUFFIXES;
}

export class UnsafeRefError extends Error {
  constructor(
    public readonly reason: string,
    public readonly safeUserMessage: string,
  ) {
    super(reason);
  }
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Validate + fetch a remote reference URL. Returns the raw bytes plus
 * the normalized MIME type. Throws `UnsafeRefError` on policy failure
 * (allowlist, oversize, bad MIME, timeout) — callers should map that
 * to a VALIDATION_ERROR provider response.
 */
export async function safeFetchReference(
  url: string,
): Promise<SafeFetchResult> {
  const parsed = parseAndValidateUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UnsafeRefError(
        `reference fetch timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`,
        'A reference asset took too long to download.',
      );
    }
    throw new UnsafeRefError(
      `reference fetch network error: ${
        err instanceof Error ? err.message : String(err)
      }`,
      'A reference asset could not be downloaded. Please try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new UnsafeRefError(
      `reference fetch HTTP ${res.status}: ${url}`,
      'A reference asset is no longer reachable.',
    );
  }

  const declaredLength = Number(res.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BYTES) {
    throw new UnsafeRefError(
      `reference fetch declared ${declaredLength} bytes > ${MAX_BYTES} cap: ${url}`,
      'A reference asset is too large (max 25 MB).',
    );
  }

  const mime = (
    res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  ).toLowerCase();
  if (!mime.startsWith(ACCEPTED_MIME_PREFIX)) {
    throw new UnsafeRefError(
      `reference fetch returned non-image MIME ${mime || '<none>'}: ${url}`,
      'A reference asset must be an image file.',
    );
  }

  // Stream-drain with a hard byte cap so a server that lies about its
  // Content-Length can't fill our heap.
  const reader = res.body?.getReader();
  if (!reader) {
    throw new UnsafeRefError(
      `reference fetch has no readable body: ${url}`,
      'A reference asset could not be downloaded.',
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new UnsafeRefError(
        `reference fetch exceeded ${MAX_BYTES} bytes mid-stream: ${url}`,
        'A reference asset is too large (max 25 MB).',
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return { bytes: merged, mime };
}

function parseAndValidateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeRefError(
      `reference URL is malformed: ${raw}`,
      'A reference URL is invalid.',
    );
  }

  // Only http(s). file:, ftp:, gopher:, data:, javascript: — all rejected.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeRefError(
      `reference URL protocol not allowed: ${parsed.protocol}`,
      'A reference URL must use http(s).',
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Private / loopback / link-local / metadata endpoints. The cloud-
  // metadata IP (169.254.169.254) is the classic SSRF target.
  if (isPrivateOrReservedHost(hostname)) {
    if (
      process.env.NODE_ENV !== 'production' &&
      (hostname === 'localhost' || hostname === '127.0.0.1')
    ) {
      log.warn(
        `permitting localhost reference URL in non-production: ${parsed.toString()}`,
      );
    } else {
      throw new UnsafeRefError(
        `reference URL host is private/reserved: ${hostname}`,
        'A reference URL is not allowed.',
      );
    }
  }

  // Allowlist check (suffix match — covers regional subdomains like
  // `fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com`).
  const suffixes = getAllowedHostSuffixes();
  const hostnameMatches =
    suffixes.some((suffix) =>
      suffix.startsWith('.')
        ? hostname.endsWith(suffix) || hostname === suffix.slice(1)
        : hostname === suffix,
    ) ||
    (process.env.NODE_ENV !== 'production' && hostname === 'localhost');
  if (!hostnameMatches) {
    throw new UnsafeRefError(
      `reference URL host not in allowlist: ${hostname}`,
      'A reference URL is not allowed.',
    );
  }

  return parsed;
}

function isPrivateOrReservedHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;

  // IP literal?
  if (net.isIPv4(hostname)) return isPrivateIPv4(hostname);
  if (net.isIPv6(hostname)) return isReservedIPv6(hostname);

  // Hostname: we don't resolve here (DNS rebinding could subvert a
  // resolve-then-fetch check anyway). The allowlist is the real
  // defence; this branch just rejects literal IPs and `localhost`.
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}
