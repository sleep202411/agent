import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';
import { resolveUserAvatar } from '../users/avatar';

/**
 * Public creators directory — read straight from the Java `client_user` table
 * (DB `fizzdragon_client`) via the scoped legacy bridge. No Java HTTP round
 * trip means no sa-token, so guests can browse without logging in. We own the
 * shape: avatars are resolved to a final URL (uploaded image, else a DiceBear
 * face) and guests are capped at GUEST_CAP rows so the rest can be gated.
 */
export interface PublicCreator {
  id: string;
  name: string;
  /** Final, ready-to-render: an absolute image URL or a DiceBear data URI. */
  avatarUrl: string;
  openToWork: boolean;
}

interface CreatorRow extends RowDataPacket {
  id: string;
  nick_name: string | null;
  avatar: string | null;
  jobseeking: number | null;
}

/** Guests may browse this many creators; the rest is gated behind login. */
const GUEST_CAP = 50;
/** Hard ceiling on a single page. */
const MAX_PAGE = 50;

// "Real users" = a non-empty nickname (skips half-created / placeholder rows).
const WHERE_REAL = "WHERE nick_name IS NOT NULL AND TRIM(nick_name) <> ''";

@Injectable()
export class LegacyCreatorsService {
  constructor(private readonly legacy: LegacyMysqlService) {}

  /** Internal bounded join for service discovery. Uses the same public-directory
   * gate; no nickname/availability data is copied into a second authority. */
  async publicCreatorBatch(ids: string[]) {
    if (!ids.length) return [];
    if (ids.length > 500)
      throw new Error('Creator lookup batch exceeds 500 IDs.');
    const requested = new Set(ids);
    const rows = await this.legacy.query<CreatorRow>(
      `SELECT CAST(id AS CHAR) AS id, nick_name, avatar, jobseeking FROM client_user
       ${WHERE_REAL} AND id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    // MySQL may coerce strings when comparing a numeric PK. Require exact IDs
    // after reading, so a malformed identifier cannot become a different user.
    return rows.filter((row) => requested.has(row.id));
  }

  /** Bounded traversal of the authoritative public directory for map discovery.
   * Keep IDs as strings and use the same lexical order as discovery cursors. */
  async publicCreatorPage(afterId: string | null) {
    if (afterId !== null && !/^[0-9]{1,64}$/.test(afterId))
      throw new Error('Invalid public creator cursor.');
    const id = 'CAST(id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin';
    return this.legacy.query<CreatorRow>(
      `SELECT CAST(id AS CHAR) AS id, nick_name, avatar, jobseeking FROM client_user
       ${WHERE_REAL} ${afterId === null ? '' : `AND ${id} > ?`}
       ORDER BY ${id} LIMIT 500`,
      afterId === null ? [] : [afterId],
    );
  }

  async publicCreatorDisplay(row: CreatorRow): Promise<PublicCreator> {
    return {
      id: row.id,
      name: row.nick_name?.trim() || 'Creator',
      avatarUrl: await resolveUserAvatar(row.avatar, row.id),
      openToWork: Number(row.jobseeking ?? 0) === 1,
    };
  }

  async listCreators(opts: {
    limit: number;
    offset: number;
    authenticated: boolean;
    /** true restricts results to open-to-work creators; false/omitted lists all. */
    availableForWork?: boolean;
  }): Promise<{
    items: PublicCreator[];
    total: number;
    requiresLogin: boolean;
  }> {
    // limit/offset are validated ints, so inlining them is injection-safe and
    // sidesteps mysql2's quirky LIMIT-placeholder handling (no bound params).
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(opts.limit)));
    const offset = Math.max(0, Math.trunc(opts.offset));

    const where = opts.availableForWork
      ? `${WHERE_REAL} AND jobseeking = 1`
      : WHERE_REAL;

    const countRow = await this.legacy.queryOne<
      RowDataPacket & { total: number }
    >(`SELECT COUNT(*) AS total FROM client_user ${where}`);
    const total = Number(countRow?.total ?? 0);

    // Guests can't page past the cap.
    if (!opts.authenticated && offset >= GUEST_CAP) {
      return { items: [], total, requiresLogin: total > GUEST_CAP };
    }
    const effLimit = opts.authenticated
      ? limit
      : Math.min(limit, GUEST_CAP - offset);

    const rows = await this.legacy.query<CreatorRow>(
      `SELECT CAST(id AS CHAR) AS id, nick_name, avatar, jobseeking
         FROM client_user ${where}
        ORDER BY create_time DESC, id DESC
        LIMIT ${effLimit} OFFSET ${offset}`,
    );

    const items = await Promise.all(
      rows.map((r) => this.publicCreatorDisplay(r)),
    );

    const requiresLogin =
      !opts.authenticated &&
      total > GUEST_CAP &&
      offset + items.length >= GUEST_CAP;
    return { items, total, requiresLogin };
  }
}
