/**
 * Environment variables.
 *
 * In Vite, public env vars use the VITE_ prefix and are accessed via import.meta.env.
 * Critical vars throw at build/startup time if missing — never silently fallback.
 */

function required(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  OSS_BASE_URL: required("VITE_OSS_BASE_URL"),
  SITE_REGION: import.meta.env.VITE_SITE_REGION ?? "global",
  PARENT_ORIGIN: import.meta.env.VITE_PARENT_ORIGIN ?? "",
} as const;
