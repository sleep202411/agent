import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Injectable,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IpStudioRequestSchema,
  IpStudioResultSchema,
  type IpStudioRequest,
  type IpStudioResult,
} from '@repo/shared/creator-location';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { CreatorDiscoveryService } from '../creator-services/creator-discovery';
import { IpCommerceService } from './ip-commerce.service';

@Injectable()
export class IpStudiosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: IpCommerceService,
    private readonly studios: CreatorDiscoveryService,
  ) {}

  async search(raw: IpStudioRequest, user?: AuthUser): Promise<IpStudioResult> {
    const input = IpStudioRequestSchema.parse(raw);
    const queryId = createHash('sha256')
      .update(
        JSON.stringify({
          ipId: input.ipId,
          locale: input.locale,
          viewer: user?.userId ?? null,
        }),
      )
      .digest('hex');
    if (input.cursor && (input.cursor.queryId !== queryId || !user))
      throw new BadRequestException('Start a new studio relationship query.');
    const pageLimit = user ? input.limit : 50;
    return this.prisma.$transaction(
      async (tx) => {
        const filters = await this.catalogue.contentGpsCatalogueFilters(
          [],
          input.locale,
          user,
          tx,
        );
        const allowed = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT ip.id FROM ips ip WHERE ip.id = ${input.ipId}::uuid AND ${filters.accessible}`,
        );
        if (!allowed.length) throw new NotFoundException('IP not found.');
        const items: IpStudioResult['items'] = [];
        let after = input.cursor?.afterId ?? null;
        // Scan contribution identities, not the currently displayed IP/studio page.
        // Keyset batches group multiple roles into one studio before pagination.
        for (;;) {
          const credits = await tx.$queryRaw<
            {
              userId: string;
              roles: { role: string; customRole: string | null }[];
            }[]
          >(Prisma.sql`
          SELECT user_id AS "userId", jsonb_agg(DISTINCT jsonb_build_object('role',role::text,'customRole',custom_role)) AS roles
          FROM ip_contributors WHERE ip_id = ${input.ipId}::uuid AND is_public = true AND removed_at IS NULL AND user_id IS NOT NULL
          ${after ? Prisma.sql`AND user_id COLLATE "C" > ${after}` : Prisma.empty}
          GROUP BY user_id ORDER BY user_id COLLATE "C" LIMIT 500`);
          if (!credits.length) break;
          const profiles = new Map(
            (
              await this.studios.publicProfiles(
                credits.map((c) => c.userId),
                tx,
                user,
              )
            ).map((profile) => [profile.id, profile]),
          );
          for (const credit of credits) {
            const studio = profiles.get(credit.userId);
            if (!studio) continue;
            items.push({
              studio,
              roles: credit.roles.sort(
                (a, b) =>
                  a.role.localeCompare(b.role) ||
                  (a.customRole ?? '').localeCompare(b.customRole ?? ''),
              ),
            });
            if (items.length > pageLimit) break;
          }
          if (items.length > pageLimit || credits.length < 500) break;
          after = credits[credits.length - 1].userId;
        }
        const hasMore = items.length > pageLimit;
        const page = items.slice(0, pageLimit);
        return IpStudioResultSchema.parse({
          requestId: input.requestId,
          ipId: input.ipId,
          locale: input.locale,
          queryId,
          items: page,
          nextCursor:
            hasMore && user
              ? { afterId: page[page.length - 1].studio.id, queryId }
              : null,
          requiresLogin: hasMore && !user,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

@Controller('ip-commerce/content-gps')
export class IpStudiosController {
  constructor(private readonly service: IpStudiosService) {}
  @Public()
  @Post('studios')
  @HttpCode(200)
  async studiosForIp(
    @Body(new ZodValidationPipe(IpStudioRequestSchema)) body: IpStudioRequest,
    @CurrentUser() user?: AuthUser,
  ) {
    return { code: 200, data: await this.service.search(body, user) };
  }
}
