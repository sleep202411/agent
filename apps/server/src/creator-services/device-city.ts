import { z } from 'zod';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { CreatorCitySchema } from '@repo/shared/creator-location';
import { CurrentUser, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  createDeviceCityGeocoder,
  DeviceCityInput,
} from './device-city-geocoder';
export const SuggestCityInput = DeviceCityInput.extend({
  requestId: z.string().uuid(),
  consent: z.literal(true),
});
const Settings = z.object({
  region: z.enum(['global', 'cn']),
  key: z.string().trim().min(1),
  daily: z.coerce.number().int().min(1).max(100000),
  concurrent: z.coerce.number().int().min(1).max(100),
});
type Attempt = { status: string; city: unknown; fresh: boolean };
@Injectable()
export class DeviceCityService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(DeviceCityService.name);
  constructor(private readonly prisma: PrismaService) {}
  private config() {
    const parsed = Settings.safeParse({
      region: process.env.CREATOR_GPS_GEOCODING_REGION,
      key: process.env.CREATOR_GPS_GEOCODING_KEY,
      daily: process.env.CREATOR_DEVICE_CITY_DAILY_LIMIT,
      concurrent: process.env.CREATOR_DEVICE_CITY_MAX_IN_FLIGHT,
    });
    if (!parsed.success)
      throw new ServiceUnavailableException(
        'Device city lookup requires a region, provider key and explicit quotas.',
      );
    return parsed.data;
  }
  onModuleInit() {
    if (process.env.CREATOR_DEVICE_CITY_ENABLED === 'true') this.config();
    this.timer = setInterval(() => {
      void this.purge().catch(() =>
        this.logger.error('Device city expiry cleanup failed.'),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async purge() {
    await this.prisma
      .$executeRaw`UPDATE creator_device_city_attempts SET city=NULL WHERE expires_at<=now() AND city IS NOT NULL`;
  }
  private subject(user: AuthUser) {
    if (!user?.userId || user.userId.length > 64)
      throw new UnauthorizedException('Sign in to suggest your city.');
    return user.userId;
  }
  async read(user: AuthUser, requestId: string) {
    const creatorId = this.subject(user);
    z.string().uuid().parse(requestId);
    const [row] = await this.prisma.$queryRaw<
      Attempt[]
    >`SELECT status,city,expires_at>now() AS fresh FROM creator_device_city_attempts WHERE creator_id=${creatorId} AND request_id=${requestId}::uuid`;
    if (!row) return { state: 'missing', city: null };
    if (!row.fresh) return { state: 'expired', city: null };
    return {
      state: row.status,
      city:
        row.status === 'completed' && row.city
          ? CreatorCitySchema.parse(row.city)
          : null,
    };
  }
  async suggest(user: AuthUser, raw: z.input<typeof SuggestCityInput>) {
    const creatorId = this.subject(user);
    const input = SuggestCityInput.parse(raw);
    if (process.env.CREATOR_DEVICE_CITY_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Device city lookup is not enabled. Enter your city manually.',
      );
    const config = this.config();
    const cost = config.region === 'cn' ? 2 : 1;
    await this.purge();
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('creator-device-city:quota')::bigint)`;
      const [prior] = await tx.$queryRaw<
        { found: number }[]
      >`SELECT 1 AS found FROM creator_device_city_attempts WHERE creator_id=${creatorId} AND request_id=${input.requestId}::uuid`;
      if (prior) return false;
      const [counts] = await tx.$queryRaw<
        { daily: bigint; concurrent: bigint; personal: bigint }[]
      >`SELECT
        COALESCE(sum(cost) FILTER (WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),0)::bigint AS daily,
        count(*) FILTER (WHERE status='dispatched' AND created_at>now()-interval '30 seconds') AS concurrent,
        count(*) FILTER (WHERE creator_id=${creatorId} AND created_at>now()-interval '1 hour') AS personal
        FROM creator_device_city_attempts WHERE created_at >= LEAST((date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), now()-interval '1 hour')`;
      if (
        counts.daily + BigInt(cost) > BigInt(config.daily) ||
        counts.concurrent >= BigInt(config.concurrent) ||
        counts.personal >= 5n
      )
        throw new ServiceUnavailableException(
          'City lookup limit reached. Enter your city manually or try later.',
        );
      const provider = config.region === 'cn' ? 'amap' : 'google';
      await tx.$executeRaw`INSERT INTO creator_device_city_attempts(creator_id,request_id,status,provider,cost,expires_at) VALUES(${creatorId},${input.requestId}::uuid,'dispatched',${provider},${cost},now()+interval '10 minutes')`;
      return true;
    });
    if (claimed) {
      try {
        // Finish the bounded attempt even if the client disconnects, enabling read-only recovery.
        const city = await createDeviceCityGeocoder({
          region: config.region,
          apiKey: config.key,
        })(
          {
            latitude: input.latitude,
            longitude: input.longitude,
            locale: input.locale,
          },
          AbortSignal.timeout(15000),
        );
        await this.prisma
          .$executeRaw`UPDATE creator_device_city_attempts SET status='completed',city=${city ? JSON.stringify(city) : null}::jsonb WHERE creator_id=${creatorId} AND request_id=${input.requestId}::uuid`;
      } catch {
        await this.prisma
          .$executeRaw`UPDATE creator_device_city_attempts SET status='uncertain',city=NULL WHERE creator_id=${creatorId} AND request_id=${input.requestId}::uuid AND status='dispatched'`;
        throw new ServiceUnavailableException(
          'City lookup failed. Check the result or enter your city manually.',
        );
      }
    }
    return this.read(user, input.requestId);
  }
}
@Controller('creator-location/me/device-city')
export class DeviceCityController {
  constructor(private readonly service: DeviceCityService) {}
  @Get(':requestId')
  async read(
    @CurrentUser() user: AuthUser,
    @Param('requestId', new ZodValidationPipe(z.string().uuid())) id: string,
  ) {
    return { code: 200, data: await this.service.read(user, id) };
  }
  @Post()
  @HttpCode(200)
  async suggest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SuggestCityInput))
    input: z.input<typeof SuggestCityInput>,
  ) {
    return { code: 200, data: await this.service.suggest(user, input) };
  }
}
