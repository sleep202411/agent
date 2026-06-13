/**
 * LegacyMysqlService — the single owned connection to the legacy Java
 * MySQL database.
 *
 * Mirrors how `DbModule` owns the `pg.Pool` for the primary store: one
 * `mysql2` pool, created at module init, lives the lifetime of the Nest
 * process, drained on shutdown. mysql2 manages connection reuse
 * underneath; callers borrow via the query helpers and never touch the
 * raw pool.
 *
 * Lifecycle:
 *   - onModuleInit       → if enabled, create the pool and `ping()` it
 *                          so a bad host/credential fails at boot, not
 *                          inside the first request. If disabled, no-op.
 *   - onApplicationShutdown → drain the pool so SIGTERM doesn't leak
 *                          sockets (same reasoning as db.module).
 *
 * Access discipline (why this layer exists at all):
 *   - We do NOT own this schema. Every query is parameterized — values
 *     ALWAYS travel as the `params` array, never string-interpolated
 *     into the SQL. This is the only injection-safe contract and it is
 *     not optional.
 *   - Errors are normalized to `ServiceUnavailableException` with
 *     `upstream: 'legacy-mysql'`, matching the Java HTTP adapter, so
 *     callers treat a legacy-DB outage the same way regardless of
 *     whether they reached Java over HTTP or over SQL.
 *   - Logs are safe by construction: we log the SQL template, the
 *     duration, and mysql2's error `code`/`errno` — never the bound
 *     params (which may carry PII) and never the password.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from 'mysql2/promise';
import { LegacyMysqlConfigService } from './legacy-mysql.config';

/** A single SQL parameter — only scalars the driver can safely bind. */
export type SqlParam = string | number | boolean | Date | null;

@Injectable()
export class LegacyMysqlService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LegacyMysqlService.name);
  private pool: Pool | null = null;

  constructor(private readonly configService: LegacyMysqlConfigService) {}

  async onModuleInit(): Promise<void> {
    const cfg = this.configService.config;
    if (!cfg.enabled) {
      this.logger.log(
        'legacy-mysql disabled — bridge dormant, pool not created',
      );
      return;
    }
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectionLimit: cfg.connectionLimit,
      connectTimeout: cfg.connectTimeoutMs,
      timezone: cfg.timezone,
      waitForConnections: true,
      // Keep prepared-statement / sql results predictable for a foreign
      // schema: surface DECIMAL/BIGINT as strings rather than lossy JS
      // numbers, and don't auto-coerce dates to local time.
      decimalNumbers: false,
      dateStrings: false,
      enableKeepAlive: true,
    });

    // Fail-fast: a wrong address or credential should crash boot, not
    // sit latent until the first admin op fires hours later.
    try {
      await this.ping();
      this.logger.log(`Connected — ${this.configService.describe()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`legacy-mysql connection failed at boot: ${msg}`);
      throw err;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /** Liveness check. Cheap round-trip; used at boot and by health. */
  async ping(): Promise<void> {
    const pool = this.requirePool();
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
  }

  /**
   * Run a parameterized SELECT and return the rows typed as `T`.
   * `params` are bound by the driver — never interpolate values into
   * `sql` yourself.
   *
   *   const rows = await legacy.query<{ id: number }>(
   *     'SELECT id FROM client_user WHERE phone = ? LIMIT 1',
   *     [phone],
   *   );
   */
  async query<T extends RowDataPacket = RowDataPacket>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T[]> {
    const pool = this.requirePool();
    const startedAt = Date.now();
    try {
      const [rows] = await pool.query<T[]>(sql, params as SqlParam[]);
      return rows;
    } catch (err) {
      throw this.toUpstreamError(err, sql, startedAt);
    }
  }

  /** Convenience: first row of a query, or null. */
  async queryOne<T extends RowDataPacket = RowDataPacket>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Run a parameterized INSERT/UPDATE/DELETE. Returns mysql2's
   * `ResultSetHeader` (affectedRows, insertId, …) so callers can assert
   * a write actually landed.
   */
  async execute(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<ResultSetHeader> {
    const pool = this.requirePool();
    const startedAt = Date.now();
    try {
      const [result] = await pool.query<ResultSetHeader>(
        sql,
        params as SqlParam[],
      );
      return result;
    } catch (err) {
      throw this.toUpstreamError(err, sql, startedAt);
    }
  }

  /**
   * Run `work` inside a single transaction on one borrowed connection.
   * Commits on success, rolls back on any throw, always releases the
   * connection. Use this for the multi-statement admin ops (e.g. credit
   * a wallet AND write the ledger row atomically).
   */
  async transaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const pool = this.requirePool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        const msg =
          rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
        this.logger.error(`legacy-mysql rollback failed: ${msg}`);
      }
      throw this.toUpstreamError(err, 'TRANSACTION', Date.now());
    } finally {
      conn.release();
    }
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error(
        'LegacyMysqlService used while disabled. Set LEGACY_MYSQL_ENABLED=true ' +
          'and provide LEGACY_MYSQL_HOST/USER/PASSWORD/DATABASE to enable the bridge.',
      );
    }
    return this.pool;
  }

  /**
   * Normalize a driver error into a log-safe `ServiceUnavailableException`.
   * Logs the SQL template (no params), the elapsed ms, and mysql2's
   * `code`/`errno` — enough to triage without leaking bound values.
   * Re-thrown bare Errors from `requirePool` (disabled state) keep their
   * own message and are not reached here.
   */
  private toUpstreamError(
    err: unknown,
    sql: string,
    startedAt: number,
  ): ServiceUnavailableException {
    const elapsed = Date.now() - startedAt;
    const driver = err as { code?: string; errno?: number };
    const template = sql.replace(/\s+/g, ' ').trim().slice(0, 200);
    this.logger.error(
      `legacy-mysql query failed after ${elapsed}ms ` +
        `[code=${driver.code ?? '?'} errno=${driver.errno ?? '?'}]: ${template}`,
    );
    return new ServiceUnavailableException({
      message: 'Legacy database unavailable',
      upstream: 'legacy-mysql',
    });
  }
}
