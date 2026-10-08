import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Res,
  Injectable,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { CreatorLocationProfileSchema } from '@repo/shared/creator-location';
import { ContentGpsPointSchema } from '@repo/shared/content-gps';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { createContentGpsGeocoder } from '../ip-commerce/content-gps-geocoder';

const Input = z.strictObject({
  expectedVersion: z.number().int().positive(),
  locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
});
const Result = z
  .strictObject({
    status: z.enum(['resolved', 'unresolved', 'ambiguous']),
    point: ContentGpsPointSchema.extend({
      precision: z.literal('city'),
    }).nullable(),
  })
  .refine((value) => (value.status === 'resolved') === (value.point !== null));
const Settings = z.object({
  region: z.enum(['global', 'cn']),
  key: z.string().trim().min(1),
  retention: z.coerce.number().int().min(1).max(2592000),
  daily: z.coerce.number().int().min(1).max(100000),
  concurrent: z.coerce.number().int().min(1).max(100),
});
type Revision = { version: number; profile: unknown };

@Injectable()
export class CreatorGeocodingService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleaning = false;
  private readonly logger = new Logger(CreatorGeocodingService.name);
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (!backgroundTasksEnabled()) return;
    const clean = () => {
      if (this.cleaning) return;
      this.cleaning = true;
      void this.purgeExpired()
        .catch(() =>
          this.logger.error('Creator geocode expiry cleanup failed.'),
        )
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
      .$executeRaw`UPDATE creator_location_geocodes SET result=NULL WHERE expires_at<=now() AND result IS NOT NULL`;
  }
  private subject(user: AuthUser) {
    if (!user?.userId || user.userId.length > 64)
      throw new UnauthorizedException('Sign in to resolve your studio city.');
    return user.userId;
  }
  private async latest(tx: Prisma.TransactionClient, creatorId: string) {
    const [row] = await tx.$queryRaw<
      Revision[]
    >`SELECT version,profile FROM creator_location_revisions WHERE creator_id=${creatorId} ORDER BY version DESC LIMIT 1`;
    return row
      ? {
          version: row.version,
          profile: CreatorLocationProfileSchema.parse(row.profile),
        }
      : null;
  }
  /** Owner read never calls providers. Public discovery still applies listing,
   * identity, viewer blocks and current consent independently. */
  async read(user: AuthUser) {
    const creatorId = this.subject(user);
    return this.prisma.$transaction(
      async (tx) => {
        const revision = await this.latest(tx, creatorId);
        const base = {
          version: revision?.version ?? 0,
          attemptId: null as string | null,
          point: null as z.infer<typeof ContentGpsPointSchema> | null,
        };
        if (!revision?.profile.showOnMap || !revision.profile.basedIn)
          return { ...base, state: 'ineligible' as const };
        const [row] = await tx.$queryRaw<
          {
            id: string;
            status: 'dispatched' | 'uncertain' | 'completed';
            result: unknown;
            fresh: boolean;
          }[]
        >`SELECT id,status,result,expires_at>now() AS fresh FROM creator_location_geocodes WHERE creator_id=${creatorId} AND version=${revision.version} ORDER BY created_at DESC,id DESC LIMIT 1`;
        if (!row)
          return {
            ...base,
            state:
              process.env.CREATOR_GPS_GEOCODING_ENABLED === 'true'
                ? ('missing' as const)
                : ('disabled' as const),
          };
        if (row.status !== 'completed')
          return { ...base, attemptId: row.id, state: row.status };
        if (!row.fresh || !row.result)
          return { ...base, attemptId: row.id, state: 'expired' as const };
        const result = Result.parse(row.result);
        return {
          ...base,
          attemptId: row.id,
          state: result.status,
          point: result.point,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async resolve(
    user: AuthUser,
    raw: z.infer<typeof Input>,
    signal: AbortSignal,
  ) {
    const creatorId = this.subject(user);
    const input = Input.parse(raw);
    if (process.env.CREATOR_GPS_GEOCODING_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Studio city geocoding is not enabled.',
      );
    const parsed = Settings.safeParse({
      region: process.env.CREATOR_GPS_GEOCODING_REGION,
      key: process.env.CREATOR_GPS_GEOCODING_KEY,
      retention: process.env.CREATOR_GPS_GEOCODING_RETENTION_SECONDS,
      daily: process.env.CREATOR_GPS_GEOCODING_DAILY_LIMIT,
      concurrent: process.env.CREATOR_GPS_GEOCODING_MAX_IN_FLIGHT,
    });
    if (!parsed.success)
      throw new ServiceUnavailableException(
        'Studio geocoding region, key, retention and quotas must be configured.',
      );
    const config = parsed.data,
      provider = config.region === 'cn' ? 'amap' : 'google';
    const lock = async (tx: Prisma.TransactionClient) => {
      // Same lock as declaration writes: opt-out and completed geocoding cannot race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-location:${creatorId}`}, 0))`;
      const latest = await this.latest(tx, creatorId);
      if (!latest || latest.version !== input.expectedVersion)
        throw new ConflictException(
          'Your studio location changed. Reload before resolving it.',
        );
      if (!latest.profile.showOnMap || !latest.profile.basedIn)
        throw new ConflictException(
          'Save a studio city and explicit map consent before resolving it.',
        );
      signal.throwIfAborted();
      return latest.profile.basedIn;
    };
    await this.purgeExpired();
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('creator-gps:geocode:quota')::bigint)`;
      const city = await lock(tx);
      const [prior] = await tx.$queryRaw<
        { status: string; fresh: boolean }[]
      >`SELECT status,expires_at>now() AS fresh FROM creator_location_geocodes WHERE creator_id=${creatorId} AND version=${input.expectedVersion} AND provider=${provider} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if (prior?.status === 'completed' && prior.fresh) return null;
      if (prior && prior.status !== 'completed')
        throw new ConflictException(
          'Studio geocoding is pending or uncertain. Check the existing attempt instead of resending.',
        );
      const [counts] = await tx.$queryRaw<
        { daily: bigint; concurrent: bigint }[]
      >`SELECT
        (SELECT count(*) FROM creator_location_geocodes WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS daily,
        (SELECT count(*) FROM creator_location_geocodes WHERE status IN ('dispatched','uncertain')) AS concurrent`;
      if (
        counts.daily >= BigInt(config.daily) ||
        counts.concurrent >= BigInt(config.concurrent)
      )
        throw new ServiceUnavailableException(
          'Studio geocoding quota or concurrency limit reached.',
        );
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO creator_location_geocodes(id,creator_id,version,provider,status,expires_at) VALUES(${id}::uuid,${creatorId},${input.expectedVersion},${provider},'dispatched',now()+make_interval(secs=>${config.retention}))`;
      return { id, city };
    });
    if (claim) {
      try {
        const geocode = createContentGpsGeocoder({
          region: config.region,
          apiKey: config.key,
        });
        const result = await geocode(
          {
            label: claim.city.city,
            countryCode: claim.city.countryCode,
            locale: input.locale,
            cityOnly: true,
          },
          signal,
        );
        const projection = Result.parse({
          status: result.status,
          point:
            result.status === 'resolved' ? result.candidates[0].point : null,
        });
        await this.prisma.$transaction(async (tx) => {
          await lock(tx);
          await tx.$executeRaw`UPDATE creator_location_geocodes SET status='completed',result=${JSON.stringify(projection)}::jsonb WHERE id=${claim.id}::uuid`;
        });
      } catch (error) {
        await this.prisma
          .$executeRaw`UPDATE creator_location_geocodes SET status='uncertain',result=NULL WHERE id=${claim.id}::uuid AND status='dispatched'`.catch(
          () => undefined,
        );
        throw error;
      }
    }
    return this.read(user);
  }
}
@Controller('creator-location/me/geocode')
export class CreatorGeocodingController {
  constructor(private readonly service: CreatorGeocodingService) {}
  @Get()
  async read(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.service.read(user) };
  }
  @Post()
  @HttpCode(200)
  async resolve(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Input)) input: z.infer<typeof Input>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    response.once('close', cancel);
    try {
      return {
        code: 200,
        data: await this.service.resolve(
          user,
          input,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        ),
      };
    } finally {
      response.off('close', cancel);
    }
  }
}
