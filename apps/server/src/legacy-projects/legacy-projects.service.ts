import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';

/**
 * Read the user's legacy Java projects straight from the MySQL `project` table
 * (DB `fizzdragon_client`) via the scoped legacy bridge — no round-trip through
 * the Java HTTP API. A project belongs to a user via `admin_user_id`; `enable`
 * (bit) is the soft-delete flag. `project.id` is a bigint beyond JS's safe
 * integer range, so it is CAST to CHAR and carried as a string end-to-end.
 */
export interface LegacyProject {
  id: string;
  name: string;
  cover: string | null;
  aspectRatio: string | null;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string | null;
  image_path: string | null;
  aspect_ratio: string | null;
  status: number | null;
  create_time: Date | null;
  update_time: Date | null;
}

const toIso = (v: Date | null) => (v ? new Date(v).toISOString() : null);

@Injectable()
export class LegacyProjectsService {
  constructor(private readonly legacy: LegacyMysqlService) {}

  async listMyProjects(
    userId: string,
    opts: { limit: number; offset: number },
  ): Promise<LegacyProject[]> {
    // limit/offset are validated ints in the controller, so inlining them is
    // injection-safe and sidesteps mysql2's quirky LIMIT-placeholder handling.
    // Only `userId` (the untrusted-shaped value) rides as a bound parameter.
    const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit)));
    const offset = Math.max(0, Math.trunc(opts.offset));
    const rows = await this.legacy.query<ProjectRow>(
      `SELECT CAST(id AS CHAR) AS id, name, image_path, aspect_ratio, status, create_time, update_time
         FROM project
        WHERE admin_user_id = ? AND enable = 1
        ORDER BY update_time DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name?.trim() || 'Untitled',
      cover: r.image_path?.trim() || null,
      aspectRatio: r.aspect_ratio?.trim() || null,
      status: Number(r.status ?? 0),
      createdAt: toIso(r.create_time),
      updatedAt: toIso(r.update_time),
    }));
  }
}
