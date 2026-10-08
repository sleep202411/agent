import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Injectable,
  ConflictException,
  ServiceUnavailableException,
  NotFoundException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContentGpsMetadataSchema } from '@repo/shared/content-gps';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
import { createContentGpsGeocoder } from './content-gps-geocoder';

const Settings = z.object({
  region: z.enum(['global', 'cn']),
  key: z.string().trim().min(1),
  retentionSeconds: z.coerce.number().int().min(1).max(2592000),
  daily: z.coerce.number().int().min(1).max(100000),
  concurrent: z.coerce.number().int().min(1).max(100),
});

@Injectable()
export class ContentGpsGeocodingService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleaning = false;
  private readonly logger = new Logger(ContentGpsGeocodingService.name);
  onModuleInit() {
    if (!backgroundTasksEnabled()) return;
    const clean = () => {
      if (this.cleaning) return;
      this.cleaning = true;
      void this.purgeExpired()
        .catch(() => this.logger.error('GPS geocode expiry cleanup failed.'))
        .finally(() => {
          this.cleaning = false;
        });
    };
    clean();
    this.timer = setInterval(clean, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async purgeExpired() {
    await this.prisma
      .$executeRaw`UPDATE ip_content_gps_geocodes SET result=NULL WHERE expires_at <= now() AND result IS NOT NULL`;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: ContentGpsSourcesService,
  ) {}

  /** Called only as part of an explicit owner analysis action. Never on reads.
   * Configuring storage duration requires the deployment owner's provider review. */
  async enrich(
    ipId: string,
    locale: 'en-US' | 'zh-CN' | 'zh-HK',
    version: string,
    user: AuthUser,
    signal: AbortSignal,
  ) {
    if (process.env.CONTENT_GPS_GEOCODING_ENABLED !== 'true') return;
    const config = Settings.safeParse({
      region: process.env.CONTENT_GPS_GEOCODING_REGION,
      key: process.env.CONTENT_GPS_GEOCODING_KEY,
      retentionSeconds: process.env.CONTENT_GPS_GEOCODING_RETENTION_SECONDS,
      daily: process.env.CONTENT_GPS_GEOCODING_DAILY_LIMIT,
      concurrent: process.env.CONTENT_GPS_GEOCODING_MAX_IN_FLIGHT,
    });
    if (!config.success)
      throw new ServiceUnavailableException(
        'GPS geocoding region, key, retention and quota limits must be configured.',
      );
    const settings = config.data;
    const provider = settings.region === 'cn' ? 'amap' : 'google';
    const geocode = createContentGpsGeocoder({
      region: settings.region,
      apiKey: settings.key,
    });
    const snapshot = await this.sources.snapshot(ipId, locale, version);
    const fingerprint = gpsSnapshotFingerprint(snapshot);
    const check = async (tx: Prisma.TransactionClient) => {
      const [owner] = await tx.$queryRaw<
        { owner: string }[]
      >`SELECT created_by_id AS owner FROM ips WHERE id=${ipId}::uuid AND deleted_at IS NULL FOR SHARE`;
      if (!user?.userId || owner?.owner !== user.userId)
        throw new NotFoundException('IP not found.');
      const fresh = await this.sources.snapshotIn(tx, ipId, locale, version);
      if (gpsSnapshotFingerprint(fresh) !== fingerprint)
        throw new ConflictException(
          'IP source text changed before geocoding completed.',
        );
      signal.throwIfAborted();
    };
    const metadata = await this.prisma.$transaction(async (tx) => {
      await check(tx);
      const [row] = await tx.$queryRaw<
        { metadata: unknown }[]
      >`SELECT metadata FROM ip_content_gps_analyses WHERE ip_id=${ipId}::uuid AND locale=${locale} AND source_fingerprint=${fingerprint} AND analysis_version=${version}`;
      if (!row)
        throw new ConflictException(
          'Current GPS analysis is required before geocoding.',
        );
      return ContentGpsMetadataSchema.parse(row.metadata);
    });
    // Remove expired provider payloads on every explicit enrichment run. Reads
    // independently exclude them even when no further enrichment is requested.
    await this.purgeExpired();
    for (const location of metadata.locations) {
      if (location.status === 'fictional' || location.status === 'ambiguous')
        continue;
      const attempt = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content-gps:geocode:quota')::bigint)`;
        await check(tx);
        const [prior] = await tx.$queryRaw<
          { status: string; fresh: boolean }[]
        >`SELECT status, expires_at > now() AS fresh FROM ip_content_gps_geocodes
          WHERE ip_id=${ipId}::uuid AND locale=${locale} AND source_fingerprint=${fingerprint} AND analysis_version=${version}
          AND location_id=${location.id} AND provider=${provider} ORDER BY created_at DESC, id DESC LIMIT 1`;
        if (prior?.status === 'completed' && prior.fresh) return null;
        if (prior && prior.status !== 'completed')
          throw new ConflictException(
            'Geocoding has a pending or uncertain outcome. Reconcile the existing attempt before another provider call.',
          );
        const [counts] = await tx.$queryRaw<
          { daily: bigint; concurrent: bigint }[]
        >`SELECT
          (SELECT count(*) FROM ip_content_gps_geocodes WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS daily,
          (SELECT count(*) FROM ip_content_gps_geocodes WHERE status IN ('dispatched','uncertain')) AS concurrent`;
        if (
          counts.daily >= BigInt(settings.daily) ||
          counts.concurrent >= BigInt(settings.concurrent)
        )
          throw new ServiceUnavailableException(
            'GPS geocoding quota or concurrency limit reached.',
          );
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO ip_content_gps_geocodes(id,ip_id,locale,source_fingerprint,analysis_version,location_id,provider,status,expires_at)
          VALUES(${id}::uuid,${ipId}::uuid,${locale},${fingerprint},${version},${location.id},${provider},'dispatched',now()+make_interval(secs=>${settings.retentionSeconds}))`;
        return id;
      });
      if (!attempt) continue;
      try {
        const result = await geocode(
          { label: location.label, locale, cityOnly: false },
          signal,
        );
        const projection = {
          status: result.status,
          point:
            result.status === 'resolved' ? result.candidates[0].point : null,
        };
        await this.prisma.$transaction(async (tx) => {
          await check(tx);
          await tx.$executeRaw`UPDATE ip_content_gps_geocodes SET status='completed',result=${JSON.stringify(projection)}::jsonb WHERE id=${attempt}::uuid`;
        });
      } catch (error) {
        await this.prisma
          .$executeRaw`UPDATE ip_content_gps_geocodes SET status='uncertain',result=NULL WHERE id=${attempt}::uuid AND status='dispatched'`.catch(
          () => undefined,
        );
        throw error;
      }
    }
  }
}
