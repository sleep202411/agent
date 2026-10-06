import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DiscoveryPreferenceRecordSchema,
  DiscoveryPreferenceUpdateSchema,
  DiscoverySiteSchema,
  discoveryLocalDay,
  type DiscoveryPreferenceRecord,
} from '@repo/shared/discovery-preferences';
import { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';

type Row = {
  revision: number;
  preferences: unknown;
  mutation_id: string;
  mutation_hash: string;
};
@Injectable()
export class DiscoveryPreferencesService {
  constructor(private readonly prisma: PrismaService) {}
  private site() {
    const value = DiscoverySiteSchema.safeParse(
      process.env.NEXT_PUBLIC_SITE_REGION,
    );
    if (!value.success)
      throw new ServiceUnavailableException(
        'Discovery site must be configured.',
      );
    return value.data;
  }
  private record(
    user: AuthUser,
    site: 'global' | 'cn',
    row?: Row,
  ): DiscoveryPreferenceRecord {
    return DiscoveryPreferenceRecordSchema.parse({
      ownerId: user.userId,
      site,
      revision: row?.revision ?? 0,
      preferences: row?.preferences ?? null,
      deliveryState: 'awaiting_design',
    });
  }
  async get(user: AuthUser) {
    const site = this.site();
    const [row] = await this.prisma.$queryRaw<
      Row[]
    >`SELECT * FROM discovery_preferences WHERE site = ${site} AND actor_id = ${user.userId}`;
    return this.record(user, site, row);
  }
  async update(user: AuthUser, raw: unknown) {
    const site = this.site();
    const input = DiscoveryPreferenceUpdateSchema.parse(raw);
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      // Serializes initial insert as well as edits and scheduling for this account/site.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-preferences:${site}:${user.userId}`}, 0))`;
      const [prior] = await tx.$queryRaw<
        Row[]
      >`SELECT * FROM discovery_preferences WHERE site = ${site} AND actor_id = ${user.userId}`;
      if (prior?.mutation_id === input.mutationId) {
        if (prior.mutation_hash !== hash)
          throw new ConflictException(
            'Preference request identity belongs to different input.',
          );
        return this.record(user, site, prior);
      }
      if ((prior?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException(
          'Preferences changed. Reload before saving.',
        );
      const json =
        input.preferences === null ? null : JSON.stringify(input.preferences);
      const [saved] = await tx.$queryRaw<
        Row[]
      >`INSERT INTO discovery_preferences(site, actor_id, revision, preferences, mutation_id, mutation_hash)
        VALUES (${site}, ${user.userId}, 1, ${json}::jsonb, ${input.mutationId}::uuid, ${hash})
        ON CONFLICT(site, actor_id) DO UPDATE SET revision = discovery_preferences.revision + 1,
          preferences = EXCLUDED.preferences, mutation_id = EXCLUDED.mutation_id, mutation_hash = EXCLUDED.mutation_hash, updated_at = now()
        RETURNING *`;
      await tx.$executeRaw`UPDATE discovery_daily_plans SET status = 'cancelled' WHERE site = ${site} AND actor_id = ${user.userId} AND status = 'reserved'`;
      return this.record(user, site, saved);
    });
  }

  /** Internal planning primitive, deliberately not wired to a timer or HTTP endpoint.
   * Final rollout must add fresh eligibility/consent checks and verified email delivery.
   * A reservation is never evidence that a recommendation was generated or sent.
   */
  async reserveDay(user: AuthUser, expectedRevision: number, now = new Date()) {
    const site = this.site();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-preferences:${site}:${user.userId}`}, 0))`;
      const [row] = await tx.$queryRaw<
        Row[]
      >`SELECT * FROM discovery_preferences WHERE site = ${site} AND actor_id = ${user.userId}`;
      const record = this.record(user, site, row);
      if (record.revision !== expectedRevision)
        throw new ConflictException('Preferences changed before scheduling.');
      const p = record.preferences;
      if (!p || (!p.channels.inApp && !p.channels.email)) return null;
      const day = discoveryLocalDay(now, p.timeZone);
      // Local-day uniqueness plus a minimum interval prevents timezone changes
      // from creating a second reservation on the same physical day.
      const rows = await tx.$queryRaw<
        { local_day: Date }[]
      >`INSERT INTO discovery_daily_plans(site, actor_id, local_day, preference_revision, time_zone, status, created_at)
        SELECT ${site}, ${user.userId}, ${day}::text::date, ${record.revision}, ${p.timeZone}, 'reserved', ${now.toISOString()}::text::timestamptz
        WHERE NOT EXISTS (SELECT 1 FROM discovery_daily_plans WHERE site = ${site} AND actor_id = ${user.userId} AND created_at > ${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}::text::timestamptz)
        ON CONFLICT DO NOTHING RETURNING local_day`;
      return rows.length
        ? {
            site,
            ownerId: user.userId,
            localDay: day,
            revision: record.revision,
          }
        : null;
    });
  }
}
