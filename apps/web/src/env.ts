/**
 * Environment variables.
 *
 * Next.js inlines `NEXT_PUBLIC_*` vars at build time for client code. On the
 * server, `process.env` reads the runtime environment. Critical vars throw if
 * missing — never silently fallback.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  OSS_BASE_URL: required("NEXT_PUBLIC_OSS_BASE_URL"),
  /** Base URL for IP project banner/avatar images (fizzdragon-banner OSS) */
  BANNER_BASE_URL: required("NEXT_PUBLIC_BANNER_BASE_URL"),
  /** Base URL for user avatar images */
  USER_BASE_URL: process.env.NEXT_PUBLIC_USER_BASE_URL ?? "",
  SITE_REGION: process.env.NEXT_PUBLIC_SITE_REGION ?? "global",
  PARENT_ORIGIN: process.env.NEXT_PUBLIC_PARENT_ORIGIN ?? "",
} as const;
