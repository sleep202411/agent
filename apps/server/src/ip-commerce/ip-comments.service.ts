import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import type { AuthUser } from '../auth';

export interface CommentRow {
  id: string;
  ipId: string;
  userId: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
}
@Injectable()
export class IpCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  async list(ipId: string, user?: AuthUser, cursor?: string) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    let before: CommentRow | undefined;
    if (cursor) {
      [before] = await this.prisma.$queryRaw<CommentRow[]>`
        SELECT id, created_at AS "createdAt" FROM ip_public_comments
        WHERE id = ${cursor}::uuid AND ip_id = ${ipId}::uuid
      `;
      if (!before) throw new BadRequestException('Invalid comment cursor.');
    }
    const rows = await this.prisma.$queryRaw<CommentRow[]>`
      SELECT id, ip_id AS "ipId", user_id AS "userId", body, author_name AS "authorName", created_at AS "createdAt"
      FROM ip_public_comments WHERE ip_id = ${ipId}::uuid AND removed_at IS NULL
      AND (${cursor ?? null}::uuid IS NULL OR (created_at, id) < ((SELECT created_at FROM ip_public_comments WHERE id = ${cursor ?? null}::uuid), ${cursor ?? null}::uuid))
      ORDER BY created_at DESC, id DESC LIMIT 51
    `;
    return {
      items: rows.slice(0, 50),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  async create(
    ipId: string,
    user: AuthUser,
    input: { body: string; requestId: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE /* ip-public-comment-create */`;
      // Reuse public visibility, localization and viewer-block rules after the lock.
      await this.ips.ensurePublicEngagementTarget(user, ipId, tx);
      const [row] = await tx.$queryRaw<CommentRow[]>`
        INSERT INTO ip_public_comments (id, ip_id, user_id, body, author_name)
        VALUES (${input.requestId}::uuid, ${ipId}::uuid, ${user.userId}, ${input.body}, ${user.nickName?.slice(0, 160) || null})
        ON CONFLICT (id) DO NOTHING
        RETURNING id, ip_id AS "ipId", user_id AS "userId", body, author_name AS "authorName", created_at AS "createdAt"
      `;
      if (row) return row;
      const [existing] = await tx.$queryRaw<CommentRow[]>`
        SELECT id, ip_id AS "ipId", user_id AS "userId", body, author_name AS "authorName", created_at AS "createdAt"
        FROM ip_public_comments WHERE id = ${input.requestId}::uuid AND ip_id = ${ipId}::uuid AND user_id = ${user.userId} AND removed_at IS NULL
      `;
      if (!existing || existing.body !== input.body)
        throw new BadRequestException('This comment request cannot be reused.');
      return existing;
    });
  }
  async moderate(ipId: string, id: string, adminId: string, reason: string) {
    const changed = await this.prisma.$executeRaw`
      UPDATE ip_public_comments SET removed_at = now(), removal_actor = ${`admin:${adminId}`}, removal_reason = ${reason}
      WHERE id = ${id}::uuid AND ip_id = ${ipId}::uuid AND removed_at IS NULL
    `;
    // A repeated moderation request retains the original actor and reason.
    if (!changed) {
      const rows = await this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ip_public_comments WHERE id = ${id}::uuid AND ip_id = ${ipId}::uuid`;
      if (!rows.length) throw new NotFoundException('Comment not found');
    }
    return { removed: true };
  }
  async remove(ipId: string, id: string, user: AuthUser) {
    const changed = await this.prisma.$executeRaw`
      UPDATE ip_public_comments SET removed_at = COALESCE(removed_at, now()), removal_actor = COALESCE(removal_actor, ${`user:${user.userId}`})
      WHERE id = ${id}::uuid AND ip_id = ${ipId}::uuid AND user_id = ${user.userId}
    `;
    if (!changed) throw new NotFoundException('Comment not found');
    return { removed: true };
  }
}
