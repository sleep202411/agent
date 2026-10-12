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
import { decodeUserId, encodeUserId } from '@repo/shared';
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

    // Users are shown/searched by their obfuscated public id (e.g. a paste from
    // a creator URL), so decode it back to the real client_user.id and match
    // that exactly. decodeUserId returns the input unchanged when it is not an
    // encoded id, so a raw id or an email/nickname just skips this branch.
    const decodedId = q ? decodeUserId(q) : '';
    const publicIdMatch = !!q && /^\d+$/.test(decodedId) && decodedId !== q;

    let where = '';
    const whereParams: SqlParam[] = [];
    if (q) {
      const clauses = [
        'phone LIKE ?',
        'email LIKE ?',
        'nick_name LIKE ?',
        'CAST(id AS CHAR) LIKE ?',
      ];
      whereParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      if (publicIdMatch) {
        clauses.push('id = ?');
        whereParams.push(decodedId);
      }
      where = `WHERE ${clauses.join(' OR ')}`;
    }

    const countRow = await this.mysql.queryOne<LegacyPointsRow>(
      `SELECT COUNT(*) AS total FROM client_user ${where}`,
      whereParams,
    );
    const total = Number(countRow?.total ?? 0);

    const rows = await this.mysql.query<LegacyPointsRow>(
      `SELECT id, phone, email, nick_name, score_balance,
              account_status, create_time
         FROM client_user ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...whereParams, pageSize, offset],
    );

    return {
      // The real client_user.id never leaves the server — the UI shows and
      // passes back the encoded public id, which inbound handlers decode.
      items: rows.map((r) => ({
        userId: encodeUserId(String(r.id)),
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
   * Emails for accounts in 正常 status (`account_status = 0`).
   * Blank emails are skipped; duplicates are collapsed case-insensitively.
   */
  async exportActiveEmails(): Promise<{
    emails: string[];
    workbook: string;
    filename: string;
    count: number;
  }> {
    const rows = await this.mysql.query<LegacyPointsRow>(
      `SELECT email
         FROM client_user
        WHERE account_status = 0
          AND email IS NOT NULL
          AND TRIM(email) <> ''
        ORDER BY id DESC`,
    );
    const seen = new Set<string>();
    const emails: string[] = [];
    for (const row of rows) {
      const email = row.email?.trim() ?? '';
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
    return {
      emails,
      workbook: buildEmailWorkbook(emails),
      filename: `active-user-emails-${new Date().toISOString().slice(0, 10)}.xls`,
      count: emails.length,
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
    // Callers pass the encoded public id; decode back to the real id to query.
    const numeric = [...new Set(ids.map((id) => decodeUserId(id)))].filter(
      (id) => /^\d{1,18}$/.test(id),
    );
    if (numeric.length === 0) return [];
    const placeholders = numeric.map(() => '?').join(',');
    const rows = await this.mysql.query<LegacyPointsRow>(
      `SELECT id, phone, email, nick_name, score_balance
         FROM client_user
        WHERE id IN (${placeholders})`,
      numeric,
    );
    // This endpoint is a pure display resolver (identity chips), so the id it
    // hands back is the encoded public one.
    return rows.map((row) => ({
      ...this.mapUser(row),
      userId: encodeUserId(String(row.id)),
    }));
  }

  /** Resolve a phone/email to a legacy user, or null if not found. */
  async findUser(identifier: string): Promise<LegacyUser | null> {
    const row = await this.mysql.queryOne<LegacyPointsRow>(
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
      const [rows] = await conn.query<LegacyPointsRow[]>(
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
    const rows = await this.mysql.query<LegacyPointsRow>(
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
      // Also match on the decoded public id — see searchMembers for the why.
      const decodedId = decodeUserId(q);
      const publicIdMatch = /^\d+$/.test(decodedId) && decodedId !== q;
      const userClauses = [
        'u.phone LIKE ?',
        'u.email LIKE ?',
        'u.nick_name LIKE ?',
        'CAST(u.id AS CHAR) LIKE ?',
      ];
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      if (publicIdMatch) {
        userClauses.push('u.id = ?');
        params.push(decodedId);
      }
      clauses.push(`(${userClauses.join(' OR ')})`);
    }
    if (recordType != null) {
      clauses.push('r.record_type = ?');
      params.push(recordType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRow = await this.mysql.queryOne<LegacyPointsRow>(
      `SELECT COUNT(*) AS total
         FROM integral_record r
         JOIN client_user u ON u.id = r.user_id
        ${where}`,
      params,
    );
    const total = Number(countRow?.total ?? 0);

    const rows = await this.mysql.query<LegacyPointsRow>(
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
        userId: encodeUserId(String(r.user_id)),
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

  private mapUser(row: LegacyPointsRow): LegacyUser {
    return {
      // Raw id — findUser feeds the grant dialogs, which pass this straight back
      // as idFormat=raw. The public-facing encode happens per-endpoint instead.
      userId: String(row.id),
      phone: row.phone ?? null,
      email: row.email ?? null,
      nickName: row.nick_name ?? null,
      scoreBalance: Number(row.score_balance ?? 0),
    };
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Excel 2003 SpreadsheetML — opens natively in Excel as a workbook. */
function buildEmailWorkbook(emails: string[]): string {
  const rows = ['email', ...emails]
    .map(
      (value) =>
        `<Row><Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell></Row>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="emails"><Table>${rows}</Table></Worksheet>` +
    `</Workbook>`
  );
}

/** String columns returned by the legacy ledger/user queries. */
interface LegacyPointsRow extends RowDataPacket {
  phone: string | null;
  email: string | null;
  nick_name: string | null;
  remark: string | null;
  model_code: string | null;
}
