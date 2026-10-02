import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { CrewAuthorizationService } from '../crews/crew-authorization.service';
import { IpCommerceService } from './ip-commerce.service';
const Params = z.object({ ipId: z.string().uuid() });
const Save = z
  .object({
    crewId: z.string().trim().min(1).max(100).nullable(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
@Injectable()
export class IpCrewOriginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
    private readonly authz: CrewAuthorizationService,
  ) {}
  async own(ipId: string, user: AuthUser) {
    await this.ips.requireEditableIp(user, ipId);
    const [row] = await this.prisma.$queryRaw<
      { crewId: string | null; version: number }[]
    >`SELECT o.crew_id AS "crewId", i.version FROM ips i LEFT JOIN ip_crew_origins o ON o.ip_id=i.id WHERE i.id=${ipId}::uuid`;
    if (!row) throw new NotFoundException('IP not found');
    const memberships = await this.prisma.crewMember.findMany({
      where: {
        userId: user.userId,
        status: 'active',
        crew: { deletedAt: null },
      },
      select: { crew: { select: { id: true, name: true } } },
    });
    const choices = [] as { id: string; name: string }[];
    for (const { crew } of memberships)
      if (await this.authz.can(crew.id, user.userId, 'production.manage'))
        choices.push(crew);
    return {
      ...row,
      choices: Array.from(
        new Map(choices.map((crew) => [crew.id, crew])).values(),
      ),
    };
  }
  async publicOrigin(ipId: string, user?: AuthUser) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const [origin] = await this.prisma.$queryRaw<
      { crewId: string }[]
    >`SELECT crew_id AS "crewId" FROM ip_crew_origins WHERE ip_id=${ipId}::uuid`;
    if (!origin) return { crew: null };
    const crew = await this.prisma.crew.findFirst({
      where: {
        id: origin.crewId,
        deletedAt: null,
        listingStatus: 'listed',
        moderationStatus: 'ok',
      },
      select: { id: true, name: true },
    });
    if (user && crew) {
      const blocked = await this.prisma.ipUserContentBlock.findFirst({
        where: {
          userId: user.userId,
          targetType: 'crew',
          targetId: crew.id,
          unblockedAt: null,
        },
        select: { id: true },
      });
      if (blocked) return { crew: null };
    }
    return { crew };
  }
  async publicCrewIps(crewId: string, user?: AuthUser) {
    const crew = await this.prisma.crew.findFirst({
      where: {
        id: crewId,
        deletedAt: null,
        moderationStatus: 'ok',
        OR: [
          { listingStatus: 'listed' },
          ...(user
            ? [
                {
                  members: {
                    some: { userId: user.userId, status: 'active' as const },
                  },
                },
              ]
            : []),
        ],
      },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    if (
      user &&
      (await this.prisma.ipUserContentBlock.findFirst({
        where: {
          userId: user.userId,
          targetType: 'crew',
          targetId: crewId,
          unblockedAt: null,
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Crew not found');
    const origins = await this.prisma.ipCrewOrigin.findMany({
      where: { crewId, ip: { listingVisibility: 'public' } },
      orderBy: { linkedAt: 'asc' },
      select: { ipId: true },
    });
    const items: { id: string }[] = [];
    for (const origin of origins) {
      try {
        await this.ips.ensurePublicEngagementTarget(user, origin.ipId);
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        throw error;
      }
      items.push({ id: origin.ipId });
    }
    return { items };
  }

  async save(ipId: string, user: AuthUser, input: z.infer<typeof Save>) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint) /* ip-origin-save */`;
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
      await this.ips.requireEditableIp(user, ipId, tx);
      if (input.crewId)
        await this.authz.require(
          input.crewId,
          user.userId,
          'production.manage',
          tx,
        );
      const changed = await tx.ip.updateMany({
        where: { id: ipId, version: input.expectedVersion },
        data: { version: { increment: 1 }, updatedById: user.userId },
      });
      if (!changed.count)
        throw new ConflictException(
          'This IP was updated elsewhere. Refresh and try again.',
        );
      if (input.crewId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:ip-link:${input.crewId}`},0))`;
        const other = await tx.ipCrewOrigin.findFirst({
          where: { crewId: input.crewId, ipId: { not: ipId } },
          select: { ipId: true },
        });
        if (other)
          throw new ConflictException(
            'This Crew already has a linked IP. Unlink it before linking another.',
          );
        await tx.$executeRaw`INSERT INTO ip_crew_origins (ip_id,crew_id,linked_by_id) VALUES (${ipId}::uuid,${input.crewId},${user.userId}) ON CONFLICT (ip_id) DO UPDATE SET crew_id=EXCLUDED.crew_id,linked_by_id=EXCLUDED.linked_by_id,linked_at=now()`;
      } else
        await tx.$executeRaw`DELETE FROM ip_crew_origins WHERE ip_id=${ipId}::uuid`;
      if (input.crewId)
        await this.authz.require(
          input.crewId,
          user.userId,
          'production.manage',
          tx,
        );
      await this.ips.requireEditableIp(user, ipId, tx);
    });
    return this.own(ipId, user);
  }
}
@Controller('ip-commerce')
export class IpCrewOriginController {
  constructor(private readonly origins: IpCrewOriginService) {}
  @Public()
  @Get('crews/:crewId/ips')
  @Header('Cache-Control', 'private, no-store')
  async crewIps(
    @Param('crewId') crewId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return { code: 200, data: await this.origins.publicCrewIps(crewId, user) };
  }

  @Public()
  @Get('ips/:ipId/crew')
  async publicOrigin(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user?: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.origins.publicOrigin(params.ipId, user),
    };
  }
  @Get('me/ips/:ipId/crew')
  async own(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
  ) {
    return { code: 200, data: await this.origins.own(params.ipId, user) };
  }
  @Put('me/ips/:ipId/crew')
  async save(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Save)) input: z.infer<typeof Save>,
  ) {
    return {
      code: 200,
      data: await this.origins.save(params.ipId, user, input),
    };
  }
}
