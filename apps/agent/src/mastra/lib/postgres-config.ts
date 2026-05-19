import type { ConnectionOptions } from "node:tls";

type PgSslConfig = boolean | ConnectionOptions;

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — required for agent Postgres storage");
  }
  return url;
}

export function postgresSslConfig(): PgSslConfig {
  const explicitMode = process.env.PGSSLMODE?.trim().toLowerCase();
  const urlMode = readConnectionParam("sslmode")?.toLowerCase();
  const urlSsl = readConnectionParam("ssl")?.toLowerCase();
  const mode = explicitMode || urlMode || urlSsl;

  switch (mode) {
    case "disable":
    case "false":
    case "0":
      return false;
    case "verify-full":
    case "verify-ca":
    case "true":
    case "1":
      return true;
    case "require":
    case "prefer":
    case "no-verify":
    default:
      // Existing managed-PG deployments use TLS without shipping a custom
      // CA bundle into the container. Keep that behaviour as the default,
      // while CN compose can opt out with PGSSLMODE=disable.
      return { rejectUnauthorized: false };
  }
}

function readConnectionParam(key: string): string | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).searchParams.get(key);
  } catch {
    return null;
  }
}
