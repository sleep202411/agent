/**
 * Single source of truth for Java service base URLs.
 *
 * Java is split into two services in this deployment:
 *   - `content`  (port 8091 in dev) — user-info, projects, videos, oss
 *   - `studio`   (port 8090 in dev) — chat, ai, anon endpoints
 *
 * Every Nest integration that calls Java reads from this module rather
 * than from `process.env` directly so:
 *   1. A typo in an env var name fails at boot, not deep inside a request.
 *   2. Future migration (Java → another service / different ports per
 *      cell) is a one-file edit instead of a grep.
 *   3. Tests can stub the helpers without touching env.
 */

const required = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.replace(/\/+$/, ''); // strip trailing slash for consistent joins
};

/** Java content service — /user, /project, /vedio, /personal. */
export const JAVA_CONTENT_URL = required(
  'JAVA_CONTENT_URL',
  process.env.NODE_ENV === 'development'
    ? 'http://120.26.152.164:8091'
    : undefined,
);

/** Java studio service — /api, /anon. */
export const JAVA_STUDIO_URL = required(
  'JAVA_STUDIO_URL',
  process.env.NODE_ENV === 'development'
    ? 'http://120.26.152.164:8090'
    : undefined,
);

/** Default per-request timeout when calling Java. Longer than typical
 *  internal-VPC round-trips so cold caches / GC pauses don't false-fail
 *  the request, but short enough to keep the page responsive. */
export const JAVA_REQUEST_TIMEOUT_MS = 5_000;
