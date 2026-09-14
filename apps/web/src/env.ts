/**
 * Environment variables.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_FOO` with the literal value **at build time**,
 * but only for static dot-access (not dynamic `process.env[name]`). Keep every access
 * as a literal below so client bundles carry the inlined value.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  OSS_BASE_URL: required("NEXT_PUBLIC_OSS_BASE_URL", process.env.NEXT_PUBLIC_OSS_BASE_URL),
  /** Base URL for IP project banner/avatar images (fizzdragon-banner OSS) */
  BANNER_BASE_URL: required("NEXT_PUBLIC_BANNER_BASE_URL", process.env.NEXT_PUBLIC_BANNER_BASE_URL),
  /** Base URL for user avatar images */
  USER_BASE_URL: process.env.NEXT_PUBLIC_USER_BASE_URL ?? "",
  /**
   * Base URL for static assets (default covers, fallback art). Mirrors
   * legacy fizzdragon-web's `STATIC_BASE_URL` — `static.fizzspace.cn` in
   * mainland envs, `fizzdragon-web-static-sg.oss-…` overseas.
   */
  STATIC_BASE_URL: process.env.NEXT_PUBLIC_STATIC_BASE_URL ?? "https://static.fizzspace.cn",
  /** Default cover used when a work has no banner / the banner 404s. */
  DEFAULT_COVER_URL: `${process.env.NEXT_PUBLIC_STATIC_BASE_URL ?? "https://static.fizzspace.cn"}/static/bg/default_bg.png`,
  SITE_REGION: required("NEXT_PUBLIC_SITE_REGION", process.env.NEXT_PUBLIC_SITE_REGION),
  PARENT_ORIGIN: process.env.NEXT_PUBLIC_PARENT_ORIGIN ?? "",
  /** Dedicated Studio host. Required for project and notification links. */
  STUDIO_HOST: required("NEXT_PUBLIC_STUDIO_HOST", process.env.NEXT_PUBLIC_STUDIO_HOST),
  /**
   * AppLovin AXON web-pixel event key. Optional — when set (and the build is
   * not CN), the ad-conversion pixel loads. See `src/lib/axon.ts`. AppLovin has
   * no China presence, so this stays empty on the .cn build.
   */
  AXON_PIXEL_KEY: process.env.NEXT_PUBLIC_AXON_PIXEL_KEY ?? "",
} as const;
