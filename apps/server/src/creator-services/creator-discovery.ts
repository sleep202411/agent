import { z } from 'zod';
import { ContentGpsPointSchema } from '@repo/shared/content-gps';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  NotFoundException,
  HttpCode,
  Injectable,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreatorDiscoveryCardSchema,
  CreatorDiscoveryRequestSchema,
  CreatorDiscoveryResultSchema,
  CreatorLocationProfileSchema,
  type CreatorDiscoveryRequest,
} from '@repo/shared/creator-location';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';

type Candidate = {
  id: string;
  profile: unknown;
  point: unknown;
  serviceCount: number;
  matchingServiceCount: number;
  locationMatch: boolean;
};
type Identity = Awaited<
  ReturnType<LegacyCreatorsService['publicCreatorBatch']>
>[number];
type Entry = { candidate: Candidate; identity: Identity; matched: boolean };
const CityPoint = ContentGpsPointSchema.extend({
  precision: z.literal('city'),
});
const BATCH = 500;
const GUEST_CAP = 50;

function candidateSql(
  input: CreatorDiscoveryRequest,
  after: string | null,
  viewerId: string | null,
  onlyCreatorId: string | null = null,
  creatorIds?: string[],
  includeWithoutServices = false,
) {
  const q = input.query;
  const city = (
    value: Prisma.Sql,
    place: NonNullable<typeof q.basedIn>,
  ) => Prisma.sql`(
    ${value}->>'countryCode' = ${place.countryCode}
    AND lower(normalize(${value}->>'city', NFKC)) = lower(normalize(${place.city}::text, NFKC)))`;
  const serviceMatch = Prisma.sql`(
    ${q.category ? Prisma.sql`s.category = ${q.category}` : Prisma.sql`TRUE`}
    AND ${q.text ? Prisma.sql`(position(lower(${q.text}) in lower(s.title)) > 0 OR ${q.text.toLowerCase()} = ANY(s.tags))` : Prisma.sql`TRUE`})`;
  return Prisma.sql`
    WITH creators AS (
      SELECT s.creator_id AS id, count(*)::int AS service_count,
        count(*) FILTER (WHERE ${serviceMatch})::int AS matching_service_count
      FROM creator_services s WHERE s.status::text = 'listed' AND s.deleted_at IS NULL
        ${onlyCreatorId ? Prisma.sql`AND s.creator_id = ${onlyCreatorId}` : Prisma.empty}
        ${creatorIds ? Prisma.sql`AND s.creator_id IN (${Prisma.join(creatorIds)})` : Prisma.empty}
        ${after ? Prisma.sql`AND s.creator_id COLLATE "C" > ${after}` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM ip_user_content_blocks b WHERE b.user_id = ${viewerId}
          AND b.target_type::text = 'creator' AND b.target_id = s.creator_id AND b.unblocked_at IS NULL)
      GROUP BY s.creator_id ORDER BY s.creator_id COLLATE "C" LIMIT ${BATCH}
    ), population AS (
      ${
        includeWithoutServices && creatorIds?.length
          ? Prisma.sql`SELECT ids.id, COALESCE(s.service_count, 0) AS service_count,
            COALESCE(s.matching_service_count, 0) AS matching_service_count
          FROM (VALUES ${Prisma.join(creatorIds.map((id) => Prisma.sql`(${id}::text)`))}) ids(id)
          LEFT JOIN creators s ON s.id = ids.id
          WHERE NOT EXISTS (SELECT 1 FROM ip_user_content_blocks b WHERE b.user_id = ${viewerId}
            AND b.target_type::text = 'creator' AND b.target_id = ids.id AND b.unblocked_at IS NULL)`
          : Prisma.sql`SELECT * FROM creators`
      }
    )
    SELECT c.id, c.service_count AS "serviceCount", c.matching_service_count AS "matchingServiceCount", p.profile, CASE WHEN (p.profile->>'showOnMap')::boolean THEN g.result->'point' ELSE NULL END AS point,
      COALESCE((
        ${q.basedIn ? Prisma.sql`(p.profile->>'showOnMap')::boolean AND ${city(Prisma.sql`(p.profile->'basedIn')`, q.basedIn)}` : Prisma.sql`TRUE`}
        AND ${q.serves ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(p.profile->'serves') place(value) WHERE ${city(Prisma.sql`place.value`, q.serves)})` : Prisma.sql`TRUE`}
        AND ${q.remoteOnly ? Prisma.sql`(p.profile->>'remote')::boolean` : Prisma.sql`TRUE`}
      ), FALSE) AS "locationMatch"
    FROM population c LEFT JOIN LATERAL (
      SELECT profile, version FROM creator_location_revisions r WHERE r.creator_id = c.id ORDER BY version DESC LIMIT 1
    ) p ON TRUE LEFT JOIN LATERAL (
      SELECT result FROM creator_location_geocodes g WHERE g.creator_id = c.id AND g.version = p.version
        AND g.status = 'completed' AND g.expires_at > now()
        AND g.result->>'status' = 'resolved' AND g.result->'point'->>'precision' = 'city'
      ORDER BY g.created_at DESC, g.id DESC LIMIT 1
    ) g ON TRUE ORDER BY c.id COLLATE "C"`;
}

@Injectable()
export class CreatorDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: LegacyCreatorsService,
  ) {}

  private async project(entry: Entry) {
    const profile = entry.candidate.profile
      ? CreatorLocationProfileSchema.parse(entry.candidate.profile)
      : null;
    return {
      ...(await this.directory.publicCreatorDisplay(entry.identity)),
      matched: entry.matched,
      basedIn: profile?.showOnMap ? profile.basedIn : null,
      serves: profile?.serves ?? [],
      remote: profile?.remote ?? false,
      showOnMap: profile?.showOnMap ?? false,
      point:
        profile?.showOnMap && entry.candidate.point
          ? CityPoint.parse(entry.candidate.point)
          : null,
      serviceCount: entry.candidate.serviceCount,
      matchingServiceCount: entry.candidate.matchingServiceCount,
    };
  }

  /** Same discovery gates and location projection, in the caller's snapshot. */
  async publicProfiles(
    ids: string[],
    tx: Prisma.TransactionClient,
    user?: AuthUser,
  ) {
    if (!ids.length) return [];
    if (ids.length > BATCH)
      throw new BadRequestException('Studio batch exceeds 500 IDs.');
    const input = CreatorDiscoveryRequestSchema.parse({
      requestId: randomUUID(),
      query: {
        basedIn: null,
        serves: null,
        remoteOnly: false,
        availableForWork: false,
        category: null,
        text: '',
      },
    });
    const candidates = await tx.$queryRaw<Candidate[]>(
      candidateSql(input, null, user?.userId ?? null, null, ids),
    );
    const identities = new Map(
      (
        await this.directory.publicCreatorBatch(candidates.map((c) => c.id))
      ).map((row) => [row.id, row]),
    );
    const results: z.infer<typeof CreatorDiscoveryCardSchema>[] = [];
    for (const candidate of candidates) {
      const identity = identities.get(candidate.id);
      if (identity)
        results.push(
          CreatorDiscoveryCardSchema.parse(
            await this.project({ candidate, identity, matched: true }),
          ),
        );
    }
    return results;
  }

  async profile(creatorId: string, user?: AuthUser) {
    const id = CreatorDiscoveryRequestSchema.shape.selectedCreatorId
      .unwrap()
      .safeParse(creatorId);
    if (!id.success || !id.data)
      throw new BadRequestException('Invalid creator ID.');
    const publicId = id.data;
    const input = CreatorDiscoveryRequestSchema.parse({
      requestId: randomUUID(),
      query: {
        basedIn: null,
        serves: null,
        remoteOnly: false,
        availableForWork: false,
        category: null,
        text: '',
      },
    });
    return this.prisma.$transaction(
      async (tx) => {
        const [candidate] = await tx.$queryRaw<Candidate[]>(
          candidateSql(input, null, user?.userId ?? null, publicId),
        );
        if (!candidate)
          throw new NotFoundException('Public studio services not found.');
        const [identity] = await this.directory.publicCreatorBatch([publicId]);
        if (!identity)
          throw new NotFoundException('Public studio services not found.');
        return CreatorDiscoveryCardSchema.parse(
          await this.project({ candidate, identity, matched: true }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async search(raw: CreatorDiscoveryRequest, user?: AuthUser) {
    const parsed = CreatorDiscoveryRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    const queryId = createHash('sha256')
      .update(
        JSON.stringify({ query: input.query, viewer: user?.userId ?? null }),
      )
      .digest('hex');
    if (input.cursor && input.cursor.queryId !== queryId)
      throw new BadRequestException(
        'This cursor belongs to a different query or account. Start a new search.',
      );
    const result = await this.prisma.$transaction(
      async (tx) => {
        let after: string | null = null,
          matchedCount = 0,
          accessibleCount = 0;
        const page: Entry[] = [];
        let selected: Entry | null = null;
        const viewport = input.map;
        const clusters = new Map<
          string,
          {
            cell: string;
            matched: boolean;
            count: number;
            creatorId: string | null;
            latitude: number;
            longitude: number;
          }
        >();
        let mapCount = 0,
          mapMatchedCount = 0,
          islandCount = 0,
          islandMatchedCount = 0;
        const width = viewport
          ? viewport.east > viewport.west
            ? viewport.east - viewport.west
            : 360 - viewport.west + viewport.east
          : 0;
        for (;;) {
          const directoryPage = await this.directory.publicCreatorPage(after);
          if (!directoryPage.length) break;
          const batch: Candidate[] = await tx.$queryRaw(
            candidateSql(
              input,
              null,
              user?.userId ?? null,
              null,
              directoryPage.map((row) => row.id),
              true,
            ),
          );
          const identities = new Map(directoryPage.map((row) => [row.id, row]));
          for (const candidate of batch) {
            const identity = identities.get(candidate.id);
            if (!identity) continue;
            const profile = candidate.profile
              ? CreatorLocationProfileSchema.parse(candidate.profile)
              : null;
            const point =
              profile?.showOnMap && candidate.point
                ? CityPoint.parse(candidate.point)
                : null;
            const islandMatch =
              !point &&
              candidate.locationMatch &&
              ((!input.query.category && !input.query.text) ||
                candidate.matchingServiceCount > 0) &&
              (!input.query.availableForWork ||
                Number(identity.jobseeking ?? 0) === 1);
            if (islandMatch && (user || islandMatchedCount < GUEST_CAP))
              islandMatchedCount++;
            if (
              !point &&
              (user || islandMatch) &&
              (user || islandCount < GUEST_CAP)
            )
              islandCount++;
            if (!input.query.islandOnly && candidate.serviceCount === 0)
              continue;
            accessibleCount++;
            const matched = input.query.islandOnly
              ? islandMatch
              : candidate.locationMatch &&
                candidate.matchingServiceCount > 0 &&
                (!input.query.availableForWork ||
                  Number(identity.jobseeking ?? 0) === 1);
            if (matched) matchedCount++;
            const visible =
              Boolean(user) || (matched && matchedCount <= GUEST_CAP);
            if (!visible) continue;
            const entry = { candidate, identity, matched };
            if (
              viewport &&
              point &&
              point.coordinateSystem === viewport.coordinateSystem &&
              point.latitude >= viewport.south &&
              point.latitude <= viewport.north &&
              (viewport.east > viewport.west
                ? point.longitude >= viewport.west &&
                  point.longitude <= viewport.east
                : point.longitude >= viewport.west ||
                  point.longitude <= viewport.east)
            ) {
              mapCount++;
              if (matched) mapMatchedCount++;
              const dx =
                (point.longitude < viewport.west
                  ? point.longitude + 360
                  : point.longitude) - viewport.west;
              const cell = `${Math.min(19, Math.floor((dx / width) * 20))}:${Math.min(9, Math.floor(((point.latitude - viewport.south) / (viewport.north - viewport.south)) * 10))}`;
              const key = `${cell}:${matched}`;
              const cluster = clusters.get(key);
              if (cluster) {
                cluster.count++;
                cluster.creatorId = null;
                cluster.latitude += point.latitude;
                cluster.longitude += dx;
              } else
                clusters.set(key, {
                  cell,
                  matched,
                  count: 1,
                  creatorId: candidate.id,
                  latitude: point.latitude,
                  longitude: dx,
                });
            }
            if (candidate.id === input.selectedCreatorId) selected = entry;
            if (
              matched &&
              (!input.cursor || candidate.id > input.cursor.afterId) &&
              page.length < input.limit + 1
            )
              page.push(entry);
          }
          after = directoryPage[directoryPage.length - 1].id;
          if (directoryPage.length < BATCH) break;
        }
        return {
          page,
          selected,
          matchedCount,
          accessibleCount,
          island: {
            creatorCount: islandCount,
            matchedCreatorCount: islandMatchedCount,
          },
          map: viewport
            ? {
                viewport,
                creatorCount: mapCount,
                matchedCreatorCount: mapMatchedCount,
                scope: 'visible_creator_results' as const,
                clusters: [...clusters.values()].map((cluster) => {
                  const longitude =
                    cluster.longitude / cluster.count + viewport.west;
                  return {
                    ...cluster,
                    latitude: cluster.latitude / cluster.count,
                    longitude: longitude > 180 ? longitude - 360 : longitude,
                  };
                }),
              }
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const hasMore = result.page.length > input.limit;
    const page = result.page.slice(0, input.limit);
    return CreatorDiscoveryResultSchema.parse({
      requestId: input.requestId,
      queryId,
      query: input.query,
      items: await Promise.all(page.map((entry) => this.project(entry))),
      selected: result.selected ? await this.project(result.selected) : null,
      map: result.map,
      island: result.island,
      matchedCount: result.matchedCount,
      accessibleCount: result.accessibleCount,
      nextCursor: hasMore
        ? { afterId: page[page.length - 1].candidate.id, queryId }
        : null,
      requiresLogin: !user && result.matchedCount > GUEST_CAP && !hasMore,
      countScope: input.query.islandOnly
        ? 'public_platform_creators'
        : 'public_platform_creators_with_listed_services',
    });
  }
}

@Controller('creator-location')
export class CreatorDiscoveryController {
  constructor(private readonly service: CreatorDiscoveryService) {}
  @Public()
  @Get('profiles/:creatorId')
  async profile(
    @Param('creatorId') creatorId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return { code: 200, data: await this.service.profile(creatorId, user) };
  }

  @Public()
  @Post('search')
  @HttpCode(200)
  async search(
    @Body(new ZodValidationPipe(CreatorDiscoveryRequestSchema))
    input: CreatorDiscoveryRequest,
    @CurrentUser() user?: AuthUser,
  ) {
    return { code: 200, data: await this.service.search(input, user) };
  }
}
