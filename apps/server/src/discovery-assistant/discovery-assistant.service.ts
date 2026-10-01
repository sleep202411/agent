import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DiscoveryAssistantRequestSchema,
  DiscoveryAssistantResultSchema,
  DiscoveryReadRequestSchema,
  DiscoveryWorkerRequestSchema,
  type DiscoveryAssistantResult,
} from '@repo/shared/discovery-assistant';
import { ContentGpsSearchResultSchema } from '@repo/shared/content-gps';
import { CreatorDiscoveryResultSchema } from '@repo/shared/creator-location';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { AgentOsWorkerClient } from '../agent-os-gateway/agent-os-worker.client';
import { ContentGpsSearchService } from '../ip-commerce/content-gps-search';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import { CreatorDiscoveryService } from '../creator-services/creator-discovery';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const Config = z.object({
  daily: z.coerce.number().int().min(1).max(100000),
  concurrent: z.coerce.number().int().min(1).max(100),
  region: z.enum(['global', 'cn']),
});
type Row = {
  request_hash: string;
  status: string;
  result: unknown;
  locale: string;
  kind: string;
  coordinate_system: 'WGS84' | 'GCJ02';
};
@Injectable()
export class DiscoveryAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModuleRef,
    private readonly ips: ContentGpsSearchService,
    private readonly creators: CreatorDiscoveryService,
    private readonly catalogue: IpCommerceService,
  ) {}

  private async row(user: AuthUser, requestId: string) {
    z.uuid().parse(requestId);
    await this.prisma
      .$executeRaw`UPDATE discovery_assistant_requests SET status = 'uncertain', read_token_hash = NULL, finished_at = now()
      WHERE actor_id = ${user.userId} AND request_id = ${requestId}::uuid AND status = 'dispatched' AND read_expires_at <= now()`;
    const [row] = await this.prisma.$queryRaw<
      Row[]
    >`SELECT * FROM discovery_assistant_requests WHERE actor_id = ${user.userId} AND request_id = ${requestId}::uuid`;
    if (!row) throw new NotFoundException('Discovery request not found.');
    return row;
  }
  async receipt(user: AuthUser, requestId: string) {
    const row = await this.row(user, requestId);
    const result =
      row.status === 'succeeded'
        ? await this.refresh(
            DiscoveryAssistantResultSchema.parse(row.result),
            user,
            row.coordinate_system,
          )
        : null;
    return { requestId, status: row.status, result };
  }
  async cancel(user: AuthUser, requestId: string) {
    z.uuid().parse(requestId);
    await this.prisma
      .$executeRaw`UPDATE discovery_assistant_requests SET status = 'cancelled', read_token_hash = NULL, finished_at = now()
      WHERE actor_id = ${user.userId} AND request_id = ${requestId}::uuid AND status = 'dispatched'`;
    return this.receipt(user, requestId);
  }
  async run(user: AuthUser, raw: unknown, signal: AbortSignal) {
    const input = DiscoveryAssistantRequestSchema.parse(raw);
    const fingerprint = hash(JSON.stringify(input));
    const [existing] = await this.prisma.$queryRaw<
      Row[]
    >`SELECT * FROM discovery_assistant_requests WHERE actor_id = ${user.userId} AND request_id = ${input.requestId}::uuid`;
    if (existing) {
      if (existing.request_hash !== fingerprint)
        throw new ConflictException(
          'Discovery request identity belongs to different input.',
        );
      return this.receipt(user, input.requestId);
    }
    if (process.env.CONTENT_GPS_DISCOVERY_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Discovery assistant is not enabled.',
      );
    const config = Config.safeParse({
      daily: process.env.CONTENT_GPS_DISCOVERY_DAILY_LIMIT,
      concurrent: process.env.CONTENT_GPS_DISCOVERY_MAX_IN_FLIGHT,
      region: process.env.CONTENT_GPS_DISCOVERY_REGION,
    });
    if (!config.success)
      throw new ServiceUnavailableException(
        'Discovery assistant limits and region must be configured.',
      );
    let worker: AgentOsWorkerClient;
    try {
      worker = this.modules.get(AgentOsWorkerClient, { strict: false });
    } catch {
      throw new ServiceUnavailableException(
        'Discovery worker is not configured.',
      );
    }
    const terms =
      input.conversation.current.kind === 'ips'
        ? await this.catalogue.listTaxonomyTerms({
            locale: input.locale,
            type: 'genre',
          })
        : { items: [] };
    const readToken = randomBytes(32).toString('hex');
    const readHash = hash(readToken);
    const coordinateSystem = config.data.region === 'cn' ? 'GCJ02' : 'WGS84';
    const workerInput = DiscoveryWorkerRequestSchema.parse({
      ...input,
      credential: { requestId: input.requestId, readToken },
      coordinateSystem,
      genres: terms.items.map((term) => ({
        code: term.code,
        label: term.label,
      })),
    });
    signal.throwIfAborted();
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('discovery-assistant:admission')::bigint)`;
      const [prior] = await tx.$queryRaw<
        Row[]
      >`SELECT * FROM discovery_assistant_requests WHERE actor_id = ${user.userId} AND request_id = ${input.requestId}::uuid`;
      if (prior) {
        if (prior.request_hash !== fingerprint)
          throw new ConflictException(
            'Discovery request identity belongs to different input.',
          );
        return false;
      }
      const [usage] = await tx.$queryRaw<
        { daily: number; active: number; own: number }[]
      >`SELECT
        count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS daily,
        count(*) FILTER (WHERE status = 'dispatched' AND read_expires_at > now())::int AS active,
        count(*) FILTER (WHERE actor_id = ${user.userId} AND status = 'dispatched' AND read_expires_at > now())::int AS own
        FROM discovery_assistant_requests`;
      if (
        usage.daily >= config.data.daily ||
        usage.active >= config.data.concurrent ||
        usage.own > 0
      )
        throw new ConflictException(
          'Discovery request quota or active request limit reached.',
        );
      await tx.$executeRaw`INSERT INTO discovery_assistant_requests(actor_id, request_id, request_hash, locale, kind, coordinate_system, read_token_hash, status, read_expires_at)
        VALUES (${user.userId}, ${input.requestId}::uuid, ${fingerprint}, ${input.locale}, ${input.conversation.current.kind}, ${coordinateSystem}, ${readHash}, 'dispatched', now() + interval '50 seconds')`;
      return true;
    });
    if (!claimed) return this.receipt(user, input.requestId);
    try {
      signal.throwIfAborted();
      const result = DiscoveryAssistantResultSchema.parse(
        await worker.discoverContentGps(workerInput, signal),
      );
      signal.throwIfAborted();
      if (
        result.status === 'results' &&
        (result.kind !== input.conversation.current.kind ||
          (result.kind === 'ips' && result.query.locale !== input.locale))
      )
        throw new ConflictException(
          'Discovery worker returned a different mode or locale.',
        );
      const fresh = await this.refresh(result, user, coordinateSystem);
      signal.throwIfAborted();
      const changed = await this.prisma
        .$executeRaw`UPDATE discovery_assistant_requests SET status = 'succeeded', result = ${JSON.stringify(fresh)}::jsonb, read_token_hash = NULL, finished_at = now()
        WHERE actor_id = ${user.userId} AND request_id = ${input.requestId}::uuid AND status = 'dispatched' AND read_expires_at > now()`;
      if (changed !== 1)
        throw new ConflictException(
          'Discovery request expired or was cancelled.',
        );
      return { requestId: input.requestId, status: 'succeeded', result: fresh };
    } catch (error) {
      await this.prisma
        .$executeRaw`UPDATE discovery_assistant_requests SET status = 'uncertain', read_token_hash = NULL, finished_at = now()
        WHERE actor_id = ${user.userId} AND request_id = ${input.requestId}::uuid AND status = 'dispatched'`;
      throw error;
    }
  }

  async read(raw: unknown) {
    const input = DiscoveryReadRequestSchema.parse(raw);
    const [row] = await this.prisma.$queryRaw<
      (Row & { actor_id: string })[]
    >`UPDATE discovery_assistant_requests SET read_count = read_count + 1
      WHERE request_id = ${input.requestId}::uuid AND read_token_hash = ${hash(input.readToken)} AND status = 'dispatched' AND read_expires_at > now() AND read_count < 16
      RETURNING *`;
    if (!row)
      throw new UnauthorizedException(
        'Discovery read credential is invalid, expired or exhausted.',
      );
    if (
      input.kind !== row.kind ||
      input.input.limit > 10 ||
      (input.kind === 'ips' &&
        (input.input.query.locale !== row.locale ||
          input.input.map.coordinateSystem !== row.coordinate_system))
    )
      throw new UnauthorizedException('Discovery read scope mismatch.');
    const user = { userId: row.actor_id };
    const result =
      input.kind === 'ips'
        ? await this.ips.search(input.input, user)
        : await this.creators.search(input.input, user);
    const [live] = await this.prisma.$queryRaw<
      { live: boolean }[]
    >`SELECT true AS live FROM discovery_assistant_requests WHERE actor_id = ${row.actor_id} AND request_id = ${input.requestId}::uuid
      AND read_token_hash = ${hash(input.readToken)} AND status = 'dispatched' AND read_expires_at > now()`;
    if (!live)
      throw new UnauthorizedException(
        'Discovery read was cancelled or expired.',
      );
    return result;
  }

  private async refresh(
    result: DiscoveryAssistantResult,
    user: AuthUser,
    coordinateSystem: 'WGS84' | 'GCJ02',
  ): Promise<DiscoveryAssistantResult> {
    if (result.status === 'clarification') return result;
    if (result.kind === 'ips') {
      const cards: typeof result.cards = [];
      let latest: z.infer<typeof ContentGpsSearchResultSchema> | undefined;
      for (const id of result.cards.length
        ? result.cards.map((card) => card.id)
        : [null]) {
        latest = ContentGpsSearchResultSchema.parse(
          await this.ips.search(
            {
              requestId: randomUUID(),
              query: result.query,
              selectedIpId: id,
              limit: 1,
              cursor: null,
              placeSearch: '',
              map: {
                coordinateSystem,
                west: -180,
                east: 180,
                south: -90,
                north: 90,
              },
            },
            user,
          ),
        );
        if (
          latest.queryId !== result.queryId ||
          (id
            ? latest.selected?.id !== id || !latest.selected.matched
            : latest.matchedCount !== 0)
        )
          throw new ConflictException(
            'Discovery results changed. Start a new search.',
          );
        if (latest.selected) cards.push(latest.selected);
      }
      return DiscoveryAssistantResultSchema.parse({
        ...result,
        cards,
        matchedCount: latest!.matchedCount,
        accessibleCount: latest!.accessibleCount,
      });
    }
    const cards: typeof result.cards = [];
    let latest: z.infer<typeof CreatorDiscoveryResultSchema> | undefined;
    for (const id of result.cards.length
      ? result.cards.map((card) => card.id)
      : [null]) {
      latest = CreatorDiscoveryResultSchema.parse(
        await this.creators.search(
          {
            requestId: randomUUID(),
            query: result.query,
            selectedCreatorId: id,
            limit: 1,
            cursor: null,
            map: null,
          },
          user,
        ),
      );
      if (
        latest.queryId !== result.queryId ||
        (id
          ? latest.selected?.id !== id || !latest.selected.matched
          : latest.matchedCount !== 0)
      )
        throw new ConflictException(
          'Discovery results changed. Start a new search.',
        );
      if (latest.selected) cards.push(latest.selected);
    }
    return DiscoveryAssistantResultSchema.parse({
      ...result,
      cards,
      matchedCount: latest!.matchedCount,
      accessibleCount: latest!.accessibleCount,
      requiresLogin: latest!.requiresLogin,
    });
  }
}
