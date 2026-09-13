import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
const saveSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    active: z.boolean(),
  })
  .strict();
const pageSchema = z.object({ cursor: z.string().uuid().optional() }).strict();
type Proof = {
  gameId: string;
  title: string;
  memberId: string;
  releaseId: string;
};
type Revision = {
  gameId: string;
  ipId: string;
  version: number;
  active: boolean;
  actorId: string;
  requestId: string;
};
@Injectable()
export class IpGameAssociationService {
  constructor(
    private readonly db: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  private proofQuery(userId: string) {
    return Prisma.sql`
  SELECT p.id AS "gameId",p.title,m.id AS "memberId",r.id AS "releaseId"
  FROM story_projects p JOIN workspaces w ON w.id=p.workspace_id
  JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=${userId} AND wm.status='active' AND wm.removed_at IS NULL
  JOIN story_project_members m ON m.story_project_id=p.id AND m.user_id=${userId} AND m.role='owner' AND m.status='active' AND m.removed_at IS NULL
  JOIN LATERAL (SELECT id FROM story_experience_game_releases r WHERE r.story_project_id=p.id AND r.game_id=p.id::text AND r.status='confirmed' AND r.media_authorization_revoked_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true
  WHERE p.status='active' AND w.status='active' AND w.deleted_at IS NULL`;
  }
  private async requireOwner(
    tx: Prisma.TransactionClient,
    gameId: string,
    userId: string,
  ) {
    const [proof] = await tx.$queryRaw<Proof[]>(
      Prisma.sql`${this.proofQuery(userId)} AND p.id=${gameId}::uuid`,
    );
    if (!proof)
      throw new NotFoundException(
        'A confirmed Story game release with current explicit ownership is required',
      );
    return proof;
  }
  async candidates(ipId: string, user: AuthUser, cursor?: string) {
    await this.ips.requireEditableIp(user, ipId);
    if (cursor) await this.requireOwner(this.db, cursor, user.userId);
    const rows = await this.db.$queryRaw<
      {
        gameId: string;
        title: string;
        version: number;
        linked: boolean;
        linkedElsewhere: boolean;
      }[]
    >(Prisma.sql`
   WITH owned AS (${this.proofQuery(user.userId)} ${cursor ? Prisma.sql`AND p.id>${cursor}::uuid` : Prisma.empty} ORDER BY p.id LIMIT 21)
   SELECT o."gameId",o.title,COALESCE(a.version,0) AS version,COALESCE(a.active AND a.ip_id=${ipId}::uuid,false) AS linked,COALESCE(a.active AND a.ip_id<>${ipId}::uuid,false) AS "linkedElsewhere"
   FROM owned o LEFT JOIN LATERAL (SELECT ip_id,version,active FROM ip_game_association_revisions WHERE game_id=o."gameId" ORDER BY version DESC LIMIT 1) a ON true ORDER BY o."gameId"`);
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19].gameId : null,
    };
  }
  async save(
    ipId: string,
    gameId: string,
    user: AuthUser,
    input: z.infer<typeof saveSchema>,
  ) {
    input = saveSchema.parse(input);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ip-game:${gameId}`},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)`;
      await this.ips.requireEditableIp(user, ipId, tx);
      const proof = await this.requireOwner(tx, gameId, user.userId);
      const [replay] = await tx.$queryRaw<
        Revision[]
      >`SELECT game_id AS "gameId",ip_id AS "ipId",version,active,actor_id AS "actorId",request_id AS "requestId" FROM ip_game_association_revisions WHERE game_id=${gameId}::uuid AND request_id=${input.requestId}::uuid`;
      if (replay) {
        if (
          replay.ipId !== ipId ||
          replay.actorId !== user.userId ||
          replay.active !== input.active ||
          replay.version !== input.expectedVersion + 1
        )
          throw new ConflictException(
            'Association retry differs from its original request',
          );
        await this.requireOwner(tx, gameId, user.userId);
        await this.ips.requireEditableIp(user, ipId, tx);
        return { gameId, version: replay.version, active: replay.active };
      }
      const [current] = await tx.$queryRaw<
        Revision[]
      >`SELECT ip_id AS "ipId",version,active FROM ip_game_association_revisions WHERE game_id=${gameId}::uuid ORDER BY version DESC LIMIT 1`;
      if (current?.active && current.ipId !== ipId)
        throw new ConflictException(
          'This game already has an IP association. Unlink it through that IP first.',
        );
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'The game association changed. Refresh before saving.',
        );
      if (!input.active && (!current?.active || current.ipId !== ipId))
        throw new ConflictException('This game is not linked to this IP');
      const version = input.expectedVersion + 1;
      await tx.$executeRaw`INSERT INTO ip_game_association_revisions(game_id,version,ip_id,release_id,owner_member_id,actor_id,active,request_id) VALUES(${gameId}::uuid,${version},${ipId}::uuid,${proof.releaseId}::uuid,${proof.memberId}::uuid,${user.userId},${input.active},${input.requestId}::uuid)`;
      await this.requireOwner(tx, gameId, user.userId);
      await this.ips.requireEditableIp(user, ipId, tx);
      return { gameId, version, active: input.active };
    });
  }
  async resolve(gameId: string, user?: AuthUser) {
    const [row] = await this.db.$queryRaw<{ ipId: string }[]>`
   SELECT a.ip_id AS "ipId" FROM (SELECT * FROM ip_game_association_revisions WHERE game_id=${gameId}::uuid ORDER BY version DESC LIMIT 1) a
   JOIN story_experience_game_releases r ON r.id=a.release_id AND r.game_id=a.game_id::text AND r.story_project_id=a.game_id
   WHERE a.active AND r.status='confirmed' AND r.media_authorization_revoked_at IS NULL`;
    if (!row) return { ipId: null };
    try {
      await this.ips.ensurePublicEngagementTarget(user, row.ipId);
    } catch (error) {
      if (error instanceof NotFoundException) return { ipId: null };
      throw error;
    }
    return { ipId: row.ipId };
  }
}
@Controller('ip-commerce')
export class IpGameAssociationController {
  constructor(private readonly links: IpGameAssociationService) {}
  @Get('me/ips/:ipId/owned-games')
  @Header('Cache-Control', 'private, no-store')
  candidates(
    @CurrentUser() u: AuthUser,
    @Param('ipId', ParseUUIDPipe) ipId: string,
    @Query(new ZodValidationPipe(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.links.candidates(ipId, u, q.cursor);
  }
  @Post('me/ips/:ipId/games/:gameId')
  save(
    @CurrentUser() u: AuthUser,
    @Param('ipId', ParseUUIDPipe) ipId: string,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body(new ZodValidationPipe(saveSchema)) b: z.infer<typeof saveSchema>,
  ) {
    return this.links.save(ipId, gameId, u, b);
  }
  @Public()
  @Get('games/:gameId/ip')
  @Header('Cache-Control', 'private, no-store')
  resolve(
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @CurrentUser() u?: AuthUser,
  ) {
    return this.links.resolve(gameId, u);
  }
}
