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

  async listCreators(opts: {
    limit: number;
    offset: number;
    authenticated: boolean;
  }): Promise<{
    items: PublicCreator[];
    total: number;
    requiresLogin: boolean;
  }> {
    // limit/offset are validated ints, so inlining them is injection-safe and
    // sidesteps mysql2's quirky LIMIT-placeholder handling (no bound params).
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(opts.limit)));
    const offset = Math.max(0, Math.trunc(opts.offset));

    const countRow = await this.legacy.queryOne<
      RowDataPacket & { total: number }
    >(`SELECT COUNT(*) AS total FROM client_user ${WHERE_REAL}`);
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
         FROM client_user ${WHERE_REAL}
        ORDER BY create_time DESC, id DESC
        LIMIT ${effLimit} OFFSET ${offset}`,
    );

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.nick_name?.trim() || 'Creator',
        avatarUrl: await resolveUserAvatar(r.avatar, r.id),
        openToWork: Number(r.jobseeking ?? 0) === 1,
      })),
    );

    const requiresLogin =
      !opts.authenticated &&
      total > GUEST_CAP &&
      offset + items.length >= GUEST_CAP;
    return { items, total, requiresLogin };
  }
}
