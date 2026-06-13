/**
 * Configuration for the legacy Java MySQL bridge.
 *
 * This is the SECOND database in the process. The primary store is
 * Postgres-via-Prisma (`infra/db`); this one is the legacy MySQL that
 * the Java backend owns. We read it (and write a few scoped admin ops)
 * but we do NOT own its schema — it evolves on the Java team's clock.
 *
 * Convention mirrors the newer provider configs (`FalConfigService`,
 * `BytePlusConfigService`): an injectable that reads `process.env`
 * exactly once in its constructor and exposes a frozen, typed config
 * object. No `ConfigService` / `ConfigModule` — the codebase reads env
 * directly with fail-fast helpers, and so do we.
 *
 * Fail-fast posture, gated on `enabled`:
 *   - LEGACY_MYSQL_ENABLED unset/false → the bridge is dormant. The app
 *     boots normally, the pool is never created, and any caller that
 *     reaches `LegacyMysqlService` gets a loud, explicit error. This is
 *     the state TODAY, before we have the DB address.
 *   - LEGACY_MYSQL_ENABLED=true → host/user/password/database are all
 *     REQUIRED. A missing one throws at construction (boot), not deep
 *     inside the first request — same ethos as `java-config.ts`.
 *
 * Security: the password lives only on the config object; it is never
 * logged. `describe()` returns a redacted summary safe for boot logs.
 */
import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const numberEnv = (
  value: string | undefined,
  fallback: number,
  min = 0,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};

export interface LegacyMysqlConfig {
  /** Master switch. When false the pool is never created. */
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  /** Max connections in the pool. Keep modest — this is a side store. */
  readonly connectionLimit: number;
  /** TCP/handshake timeout for acquiring a new connection (ms). */
  readonly connectTimeoutMs: number;
  /**
   * Session timezone. The Java DB stores DATETIME without offset; pin
   * to 'Z' so mysql2 reads/writes UTC consistently instead of guessing
   * from the Node process TZ. Override only if the legacy data is known
   * to be wall-clock in a fixed offset.
   */
  readonly timezone: string;
}

@Injectable()
export class LegacyMysqlConfigService {
  private readonly value: LegacyMysqlConfig;

  constructor() {
    const enabled = boolEnv(process.env.LEGACY_MYSQL_ENABLED, false);
    this.value = Object.freeze({
      enabled,
      host: this.required('LEGACY_MYSQL_HOST', enabled),
      port: numberEnv(process.env.LEGACY_MYSQL_PORT, 3306, 1),
      user: this.required('LEGACY_MYSQL_USER', enabled),
      password: this.required('LEGACY_MYSQL_PASSWORD', enabled),
      database: this.required('LEGACY_MYSQL_DATABASE', enabled),
      connectionLimit: numberEnv(process.env.LEGACY_MYSQL_POOL_SIZE, 5, 1),
      connectTimeoutMs: numberEnv(
        process.env.LEGACY_MYSQL_CONNECT_TIMEOUT_MS,
        10_000,
        1_000,
      ),
      timezone: process.env.LEGACY_MYSQL_TIMEZONE?.trim() || 'Z',
    });
  }

  get config(): LegacyMysqlConfig {
    return this.value;
  }

  /**
   * Required only when the bridge is enabled. When disabled we tolerate
   * the var being absent (returns '') so the app boots without legacy
   * config present.
   */
  private required(name: string, enabled: boolean): string {
    const v = process.env[name]?.trim();
    if (enabled && !v) {
      throw new Error(
        `Missing required env var: ${name} (LEGACY_MYSQL_ENABLED=true)`,
      );
    }
    return v ?? '';
  }

  /** Redacted one-liner for boot logs — never includes the password. */
  describe(): string {
    const c = this.value;
    if (!c.enabled) return 'legacy-mysql: disabled';
    return `legacy-mysql: ${c.user}@${c.host}:${c.port}/${c.database} (pool=${c.connectionLimit})`;
  }
}
