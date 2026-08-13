/**
 * LegacyPointsService — admin grant/deduct against the Java legacy
 * points balance (`client_user.score_balance` in `fizzdragon_client`).
 *
 * Why this exists: AI image/video gen in apps/web still deducts from
 * this old MySQL balance. Until that's migrated, customer service needs
 * a way to top up (or correct) a user's legacy points. This is the
 * NestJS-owned replacement for the dead boss-admin `/admin/data/integral/Add`.
 *
 * Mechanism (the load-bearing detail — see the Java cron in
 * AIRecordController.addIntegralRecord): `score_balance` is normally
 * settled by a once-a-minute Java cron that processes `integral_record`
 * rows with `current_balance IS NULL`. We instead apply the balance
 * synchronously and write a ledger row with `current_balance` ALREADY
 * SET — that row's non-null `current_balance` makes the cron skip it, so
 * there's no double-count. The grant reflects immediately.
 *
 * Residual race (accepted for low-frequency manual grants): the cron is
 * a concurrent, lock-free writer of the same column. If a consume for
 * the SAME user settles in the same cron tick as our grant, the cron's
 * read-old-then-write-absolute can clobber us. The `FOR UPDATE` lock
 * here serializes our own writes; it can't fully fence the cron's
 * unlocked read. The window is sub-second, once/min, same-user-only.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { LegacyMysqlService, type SqlParam } from '../infra/legacy-mysql';

export interface LegacyUser {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  scoreBalance: number;
}

export interface MemberSummary {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  scoreBalance: number;
  accountStatus: number | null;
  createTime: string | null;
}

export interface MemberSearchResult {
  items: MemberSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** A global ledger row — an integral_record joined to its owning user. */
export interface LegacyLedgerRow {
  id: string;
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  recordType: number;
  integralChange: number | null;
  currentBalance: number | null;
  remark: string | null;
  modelCode: string | null;
  createTime: string | null;
}

export interface LegacyLedgerResult {
  items: LegacyLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GrantResult {
  userId: string;
  previousBalance: number;
  delta: number;
  newBalance: number;
  recordId: string;
}

export interface LegacyPointRecord {
  id: string;
  recordType: number;
  integralChange: number | null;
  currentBalance: number | null;
  remark: string | null;
  modelCode: string | null;
  createTime: string | null;
}

@Injectable()
export class LegacyPointsService {
  private readonly logger = new Logger(LegacyPointsService.name);

  constructor(private readonly mysql: LegacyMysqlService) {}

  /**
   * Paginated user directory. `query` fuzzy-matches phone / email /
   * nickname / id (all LIKE %q%); empty lists newest-first. Read-only.
   */
  async searchMembers(input: {
    query?: string;
    page: number;
    pageSize: number;
  }): Promise<MemberSearchResult> {
    const { query, page, pageSize } = input;
    const offset = (page - 1) * pageSize;
    const q = query?.trim();

    const where = q
      ? `WHERE phone LIKE ? OR email LIKE ? OR nick_name LIKE ? OR CAST(id AS CHAR) LIKE ?`
      : '';
    const likeParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];

    const countRow = await this.mysql.queryOne<RowDataPacket>(
      `SELECT COUNT(*) AS total FROM client_user ${where}`,
      likeParams,
    );
    const total = Number(countRow?.total ?? 0);

    const rows = await this.mysql.query<RowDataPacket>(
      `SELECT id, phone, email, nick_name, score_balance,
              account_status, create_time
         FROM client_user ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...likeParams, pageSize, offset],
    );

    return {
      items: rows.map((r) => ({
        userId: String(r.id),
        phone: r.phone ?? null,
        email: r.email ?? null,
        nickName: r.nick_name ?? null,
        scoreBalance: Number(r.score_balance ?? 0),
        accountStatus:
          r.account_status == null ? null : Number(r.account_status),
        createTime: r.create_time ? String(r.create_time) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Resolve legacy user ids to their display identity, in one round trip.
   *
   * Workspaces carry only an external `ownerUserId` (no user table on our side
   * — see the Workspace model), so any surface that lists workspaces owned by
   * other people has ids and nothing else. This turns a batch of them into
   * names without N queries. Unknown ids are simply absent from the result.
   */
  async findUsersByIds(ids: string[]): Promise<LegacyUser[]> {
    const numeric = [...new Set(ids)].filter((id) => /^\d{1,18}$/.test(id));
    if (numeric.length === 0) return [];
    const placeholders = numeric.map(() => '?').join(',');
    const rows = await this.mysql.query<RowDataPacket>(
      `SELECT id, phone, email, nick_name, score_balance
         FROM client_user
        WHERE id IN (${placeholders})`,
      numeric,
    );
    return rows.map((row) => this.mapUser(row));
  }

  /** Resolve a phone/email to a legacy user, or null if not found. */
  async findUser(identifier: string): Promise<LegacyUser | null> {
    const row = await this.mysql.queryOne<RowDataPacket>(
      `SELECT id, phone, email, nick_name, score_balance
         FROM client_user
        WHERE phone = ? OR email = ?
        LIMIT 1`,
      [identifier, identifier],
    );
    return row ? this.mapUser(row) : null;
  }

  /**
   * Grant (or deduct, if score < 0) legacy points. Atomic per the
   * module doc: lock the row, write the absolute new balance, append a
   * settled ledger row. Throws 404 if the user isn't found, 400 if a
   * deduction would drive the balance below zero.
   */
  async grantPoints(input: {
    identifier: string;
    score: number;
    operatorId: string;
    note?: string;
  }): Promise<GrantResult> {
    const { identifier, score, operatorId, note } = input;

    return this.mysql.transaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, score_balance
           FROM client_user
          WHERE phone = ? OR email = ?
          LIMIT 1
          FOR UPDATE`,
        [identifier, identifier],
      );
      const user = rows[0];
      if (!user) {
        throw new NotFoundException({
          message: 'No legacy user matches that phone/email',
          identifier,
        });
      }

      const previous = Number(user.score_balance ?? 0);
      const next = previous + score;
      if (next < 0) {
        throw new BadRequestException({
          message: 'Deduction would drive balance below zero',
          previousBalance: previous,
          delta: score,
        });
      }

      await conn.query(
        `UPDATE client_user SET score_balance = ?, update_time = NOW() WHERE id = ?`,
        [next, user.id],
      );

      // record_type=3 (系统赠送). current_balance is set NON-NULL on
      // purpose so the Java reconciliation cron (which only touches
      // rows WHERE current_balance IS NULL) never re-applies it.
      // remark must NOT contain the cron's "Score-code-recharge:::"
      // magic token — a plain admin note never does.
      const remark = note
        ? `admin#${operatorId}: ${note}`
        : `admin#${operatorId} manual grant`;
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO integral_record
           (user_id, use_user_id, record_type, integral_change,
            current_balance, status, remark, create_time, update_time)
         VALUES (?, ?, 3, ?, ?, 1, ?, NOW(), NOW())`,
        [user.id, user.id, score, next, remark],
      );

      this.logger.log(
        `legacy points: user=${user.id} ${previous}->${next} (${score >= 0 ? '+' : ''}${score}) by admin#${operatorId}`,
      );

      return {
        userId: String(user.id),
        previousBalance: previous,
        delta: score,
        newBalance: next,
        recordId: String(result.insertId),
      };
    });
  }

  /** Recent ledger rows for a user, newest first. For audit on-screen. */
  async listRecentRecords(
    identifier: string,
    limit: number,
  ): Promise<LegacyPointRecord[]> {
    const rows = await this.mysql.query<RowDataPacket>(
      `SELECT r.id, r.record_type, r.integral_change, r.current_balance,
              r.remark, r.model_code, r.create_time
         FROM integral_record r
         JOIN client_user u ON u.id = r.user_id
        WHERE u.phone = ? OR u.email = ?
        ORDER BY r.id DESC
        LIMIT ?`,
      [identifier, identifier, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      recordType: Number(r.record_type),
      integralChange:
        r.integral_change == null ? null : Number(r.integral_change),
      currentBalance:
        r.current_balance == null ? null : Number(r.current_balance),
      remark: r.remark ?? null,
      modelCode: r.model_code ?? null,
      createTime: r.create_time ? String(r.create_time) : null,
    }));
  }

  /**
   * Global paginated points ledger across ALL users. `query` fuzzy-matches
   * the owning user (phone/email/nickname/id); `recordType` filters
   * 充值/消费/系统赠送. Newest first by surrogate key. Read-only.
   */
  async listLedgerRecords(input: {
    query?: string;
    recordType?: number;
    page: number;
    pageSize: number;
  }): Promise<LegacyLedgerResult> {
    const { query, recordType, page, pageSize } = input;
    const offset = (page - 1) * pageSize;
    const q = query?.trim();

    const clauses: string[] = [];
    const params: SqlParam[] = [];
    if (q) {
      clauses.push(
        '(u.phone LIKE ? OR u.email LIKE ? OR u.nick_name LIKE ? OR CAST(u.id AS CHAR) LIKE ?)',
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (recordType != null) {
      clauses.push('r.record_type = ?');
      params.push(recordType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRow = await this.mysql.queryOne<RowDataPacket>(
      `SELECT COUNT(*) AS total
         FROM integral_record r
         JOIN client_user u ON u.id = r.user_id
        ${where}`,
      params,
    );
    const total = Number(countRow?.total ?? 0);

    const rows = await this.mysql.query<RowDataPacket>(
      `SELECT r.id, r.user_id, u.phone, u.email, u.nick_name,
              r.record_type, r.integral_change, r.current_balance,
              r.remark, r.model_code, r.create_time
         FROM integral_record r
         JOIN client_user u ON u.id = r.user_id
        ${where}
        ORDER BY r.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return {
      items: rows.map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        phone: r.phone ?? null,
        email: r.email ?? null,
        nickName: r.nick_name ?? null,
        recordType: Number(r.record_type),
        integralChange:
          r.integral_change == null ? null : Number(r.integral_change),
        currentBalance:
          r.current_balance == null ? null : Number(r.current_balance),
        remark: r.remark ?? null,
        modelCode: r.model_code ?? null,
        createTime: r.create_time ? String(r.create_time) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  private mapUser(row: RowDataPacket): LegacyUser {
    return {
      userId: String(row.id),
      phone: row.phone ?? null,
      email: row.email ?? null,
      nickName: row.nick_name ?? null,
      scoreBalance: Number(row.score_balance ?? 0),
    };
  }
}
