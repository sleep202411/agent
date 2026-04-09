/**
 * Environment variables.
 *
 * In Vite, public env vars use the VITE_ prefix and are accessed via import.meta.env.
 */
export const env = {
  OSS_BASE_URL: import.meta.env.VITE_OSS_BASE_URL ?? "",
  SITE_REGION: import.meta.env.VITE_SITE_REGION ?? "global",
  PARENT_ORIGIN: import.meta.env.VITE_PARENT_ORIGIN ?? "",
} as const;
