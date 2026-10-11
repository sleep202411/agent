import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Injectable,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContentGpsSearchRequestSchema,
  ContentGpsSearchResultSchema,
  type ContentGpsSearchRequest,
} from '@repo/shared/content-gps';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { contentGpsSearchSql } from './content-gps-search-sql';

@Injectable()
export class ContentGpsSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: IpCommerceService,
  ) {}

  async search(raw: ContentGpsSearchRequest, user?: AuthUser) {
    const parsed = ContentGpsSearchRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    if (input.query.duration?.unit === 'film')
      throw new BadRequestException(
        'Film duration is not available. Choose individual episode duration.',
      );
    if (input.query.moodPreferences.length)
      throw new BadRequestException(
        'Mood recommendations are not available for structured catalogue search.',
      );
    // Owner locations and published catalogue fields do not require AI analysis.
    // NULL deliberately excludes all AI snapshots until an explicit version is configured.
    const version = process.env.CONTENT_GPS_ANALYSIS_VERSION?.trim() || null;
    if (version && version.length > 200)
      throw new ServiceUnavailableException(
        'Content GPS analysis version is invalid.',
      );
    const queryId = createHash('sha256')
      .update(
        JSON.stringify({
          query: input.query,
          viewer: user?.userId ?? null,
          version,
        }),
      )
      .digest('hex');
    if (input.cursor && input.cursor.queryId !== queryId)
      throw new BadRequestException(
        'This cursor belongs to a different query or account. Start a new search.',
      );
    const result = await this.prisma.$transaction(
      async (tx) => {
        const filters = await this.catalogue.contentGpsCatalogueFilters(
          input.query.genreCodes,
          input.query.locale,
          user,
          tx,
        );
        const [row] = await tx.$queryRaw<
          {
            result: Record<string, unknown> & {
              nextId: string | null;
              items: ({ id: string } & Record<string, unknown>)[];
              selected: ({ id: string } & Record<string, unknown>) | null;
            };
          }[]
        >(contentGpsSearchSql(input, filters, version));
        const ids = [
          ...new Set([
            ...row.result.items.map((item) => item.id),
            ...(row.result.selected ? [row.result.selected.id] : []),
          ]),
        ];
        const display = await this.catalogue.contentGpsPresentations(
          ids,
          input.query.locale,
          tx,
        );
        return {
          ...row.result,
          items: row.result.items.map((item) => ({
            ...item,
            ...display.get(item.id),
          })),
          selected: row.result.selected
            ? { ...row.result.selected, ...display.get(row.result.selected.id) }
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const { nextId, ...payload } = result;
    return ContentGpsSearchResultSchema.parse({
      ...payload,
      requestId: input.requestId,
      queryId,
      nextCursor: nextId ? { afterId: nextId, queryId } : null,
      query: input.query,
      mapScope: input.map,
      countScope: 'accessible_ips_with_published_translation',
    });
  }
}

@Controller('ip-commerce/content-gps')
export class ContentGpsSearchController {
  constructor(private readonly service: ContentGpsSearchService) {}

  @Public()
  @Post('search')
  @HttpCode(200)
  async search(
    @Body(new ZodValidationPipe(ContentGpsSearchRequestSchema))
    body: ContentGpsSearchRequest,
    @CurrentUser() user?: AuthUser,
  ) {
    return { code: 200, data: await this.service.search(body, user) };
  }
}
