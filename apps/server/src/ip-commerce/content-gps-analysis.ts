import { contentGpsGeocodedMetadataSql } from './content-gps-geocode-sql';
import { z } from 'zod';
import {
  ConflictException,
  Injectable,
  BadRequestException,
  NotFoundException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContentGpsExtractionRequestSchema,
  ContentGpsMetadataSchema,
  ContentGpsOwnerSuggestionsSchema,
  type ContentGpsExtractionRequest,
  type ContentGpsMetadata,
} from '@repo/shared/content-gps';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
import { OwnerLocationsSchema } from './content-gps-locations';

/** Nest owns storage. Worker output never grants public visibility and never
 * overwrites owner assertions. Callers must still apply catalogue viewer gates. */
@Injectable()
export class ContentGpsAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: ContentGpsSourcesService,
  ) {}

  async save(
    rawSnapshot: ContentGpsExtractionRequest,
    rawMetadata: ContentGpsMetadata,
  ) {
    const snapshot = ContentGpsExtractionRequestSchema.parse(rawSnapshot);
    const metadata = ContentGpsMetadataSchema.parse(rawMetadata);
    const fingerprint = gpsSnapshotFingerprint(snapshot);
    if (
      metadata.ipId !== snapshot.ipId ||
      metadata.sourceFingerprint !== fingerprint ||
      metadata.analysisVersion !== snapshot.analysisVersion ||
      metadata.analyzedAt !== snapshot.analyzedAt ||
      metadata.review.status !== 'unreviewed' ||
      metadata.locations.some((location) => location.point !== null)
    )
      throw new BadRequestException(
        'GPS analysis does not match its source snapshot.',
      );
    // Coordinates must be added by a separate verified geocoder step; not accepted
    // from this extraction boundary. Every evidence span points into host text.
    for (const evidence of metadata.evidence) {
      const source = snapshot.sources.find(
        (candidate) =>
          candidate.sourceId === evidence.sourceId &&
          candidate.sourceType === evidence.sourceType &&
          candidate.sourceVersion === evidence.sourceVersion &&
          evidence.locator.startsWith(`${candidate.id}:utf16:`),
      );
      const suffix =
        source && evidence.locator.slice(`${source.id}:utf16:`.length);
      const match = typeof suffix === 'string' && /^(\d+):(\d+)$/.exec(suffix);
      const start = match ? Number(match[1]) : -1;
      const end = match ? Number(match[2]) : -1;
      if (
        !source ||
        source.visibilityAtAnalysis !== 'public' ||
        evidence.visibilityAtAnalysis !== 'public' ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > source.text.length
      )
        throw new BadRequestException(
          'GPS evidence does not match public source text.',
        );
    }
    return this.persist(async (tx) => {
      const current = await this.sources.snapshotIn(
        tx,
        snapshot.ipId,
        snapshot.locale,
        snapshot.analysisVersion,
      );
      if (gpsSnapshotFingerprint(current) !== fingerprint)
        throw new ConflictException(
          'IP source text changed. Discard this analysis.',
        );
      // Source-addressed identity means a late older response cannot replace a
      // newer source. INSERT preserves the first successful result across retries.
      await tx.$executeRaw`
        INSERT INTO ip_content_gps_analyses (ip_id, locale, source_fingerprint, analysis_version, metadata, source_snapshot)
        VALUES (${snapshot.ipId}::uuid, ${snapshot.locale}, ${fingerprint}, ${snapshot.analysisVersion}, ${JSON.stringify(metadata)}::jsonb,
          ${JSON.stringify([...current.sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))}::jsonb)
        ON CONFLICT DO NOTHING`;
      const [saved] = await tx.$queryRaw<{ metadata: unknown }[]>`
        SELECT metadata FROM ip_content_gps_analyses WHERE ip_id = ${snapshot.ipId}::uuid
        AND locale = ${snapshot.locale} AND source_fingerprint = ${fingerprint} AND analysis_version = ${snapshot.analysisVersion}`;
      return ContentGpsMetadataSchema.parse(saved.metadata);
    });
  }

  private async persist<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // Retry only the local transaction, never the model call. PostgreSQL can
    // abort a concurrent INSERT ON CONFLICT at RepeatableRead isolation.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
      } catch (error) {
        const parsed = z
          .object({
            code: z.string(),
            meta: z
              .object({
                code: z.string().optional(),
                driverAdapterError: z
                  .object({
                    cause: z.object({
                      originalCode: z.string().optional(),
                      kind: z.string().optional(),
                    }),
                  })
                  .optional(),
              })
              .optional(),
          })
          .safeParse(error);
        const retryable =
          parsed.success &&
          (parsed.data.code === 'P2034' ||
            (parsed.data.code === 'P2010' &&
              (parsed.data.meta?.code === '40001' ||
                parsed.data.meta?.driverAdapterError?.cause.originalCode ===
                  '40001' ||
                parsed.data.meta?.driverAdapterError?.cause.kind ===
                  'TransactionWriteConflict')));
        if (!retryable || attempt >= 2) throw error;
      }
    }
  }

  async suggestions(
    ipId: string,
    locale: ContentGpsExtractionRequest['locale'],
    user: AuthUser,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const [owner] = await tx.$queryRaw<{ createdById: string }[]>`
        SELECT created_by_id AS "createdById" FROM ips WHERE id = ${ipId}::uuid AND deleted_at IS NULL FOR SHARE`;
        if (!user?.userId || owner?.createdById !== user.userId)
          throw new NotFoundException('IP not found.');
        const [revision] = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM ip_content_gps_location_revisions WHERE ip_id = ${ipId}::uuid ORDER BY version DESC LIMIT 1`;
        const version = process.env.CONTENT_GPS_ANALYSIS_VERSION?.trim();
        const empty = (state: 'missing' | 'ineligible' | 'unconfigured') =>
          ContentGpsOwnerSuggestionsSchema.parse({
            state,
            analysisVersion: version || null,
            analyzedAt: null,
            ownerVersion: revision?.version ?? 0,
            locations: [],
          });
        if (!version) return empty('unconfigured');
        let snapshot: ContentGpsExtractionRequest;
        try {
          snapshot = await this.sources.snapshotIn(tx, ipId, locale, version);
        } catch (error) {
          if (error instanceof NotFoundException) return empty('ineligible');
          throw error;
        }
        const fingerprint = gpsSnapshotFingerprint(snapshot);
        const [row] = await tx.$queryRaw<{ metadata: unknown }[]>`
        SELECT ${contentGpsGeocodedMetadataSql(Prisma.sql`a`)} AS metadata FROM ip_content_gps_analyses a WHERE ip_id = ${ipId}::uuid AND locale = ${locale}
        AND analysis_version = ${version} AND source_fingerprint = ${fingerprint}`;
        if (!row) return empty('missing');
        const metadata = ContentGpsMetadataSchema.parse(row.metadata);
        const locations = metadata.locations.map((location) => ({
          id: location.id,
          kind: location.kind,
          label: location.label,
          status: location.status,
          point: location.point,
          evidence: location.evidenceIds.map((id) => {
            const evidence = metadata.evidence.find(
              (value) => value.id === id,
            )!;
            const source = snapshot.sources.find(
              (value) =>
                value.sourceId === evidence.sourceId &&
                value.sourceType === evidence.sourceType &&
                value.sourceVersion === evidence.sourceVersion &&
                evidence.locator.startsWith(`${value.id}:utf16:`),
            );
            const span =
              source &&
              /^(\d+):(\d+)$/.exec(
                evidence.locator.slice(`${source.id}:utf16:`.length),
              );
            const start = span ? Number(span[1]) : -1,
              end = span ? Number(span[2]) : -1;
            if (
              !source ||
              evidence.visibilityAtAnalysis !== 'public' ||
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start < 0 ||
              end <= start ||
              end > source.text.length
            )
              throw new BadRequestException('Stored GPS evidence is invalid.');
            return {
              sourceType: source.sourceType,
              field: source.locator,
              quote: source.text.slice(start, end),
            };
          }),
        }));
        return ContentGpsOwnerSuggestionsSchema.parse({
          state: 'ready',
          analysisVersion: version,
          analyzedAt: metadata.analyzedAt,
          ownerVersion: revision?.version ?? 0,
          locations,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Internal fresh projection, not a public API. A missing/stale analysis is
   * explicit; an owner's empty override remains authoritative over suggestions. */
  async current(
    ipId: string,
    locale: ContentGpsExtractionRequest['locale'],
    analysisVersion: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const snapshot = await this.sources.snapshotIn(
          tx,
          ipId,
          locale,
          analysisVersion,
        );
        const fingerprint = gpsSnapshotFingerprint(snapshot);
        const [row] = await tx.$queryRaw<{ metadata: unknown }[]>`
        SELECT ${contentGpsGeocodedMetadataSql(Prisma.sql`a`)} AS metadata FROM ip_content_gps_analyses a WHERE ip_id = ${ipId}::uuid
        AND locale = ${locale} AND source_fingerprint = ${fingerprint} AND analysis_version = ${analysisVersion}`;
        const [owner] = await tx.$queryRaw<
          { version: number; locations: unknown }[]
        >`
        SELECT version, locations FROM ip_content_gps_location_revisions
        WHERE ip_id = ${ipId}::uuid ORDER BY version DESC LIMIT 1`;
        const analysis = row
          ? ContentGpsMetadataSchema.parse(row.metadata)
          : null;
        return {
          analysis,
          sourceFingerprint: fingerprint,
          ownerVersion: owner?.version ?? 0,
          locations: owner
            ? OwnerLocationsSchema.parse(owner.locations)
            : (analysis?.locations ?? []),
          locationSource: owner
            ? ('owner' as const)
            : analysis
              ? ('analysis' as const)
              : ('unknown' as const),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

@Controller('ip-commerce/me/ips/:ipId/content-gps')
export class ContentGpsSuggestionsController {
  constructor(private readonly analyses: ContentGpsAnalysisService) {}
  @Get('suggestions')
  async suggestions(
    @Param(new ZodValidationPipe(z.object({ ipId: z.string().uuid() })))
    params: { ipId: string },
    @Query(
      new ZodValidationPipe(
        z.object({ locale: z.enum(['en-US', 'zh-CN', 'zh-HK']) }),
      ),
    )
    query: { locale: ContentGpsExtractionRequest['locale'] },
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.analyses.suggestions(params.ipId, query.locale, user),
    };
  }
}
