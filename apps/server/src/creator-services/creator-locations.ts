import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreatorLocationProfileSchema,
  SaveCreatorLocationProfileSchema,
  type CreatorLocationProfile,
  type SaveCreatorLocationProfile,
} from '@repo/shared/creator-location';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';

type Revision = {
  version: number;
  expectedVersion: number;
  requestId: string;
  profile: CreatorLocationProfile;
  updatedAt: Date;
};

@Injectable()
export class CreatorLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private subject(user: AuthUser) {
    if (!user?.userId || user.userId.length > 64)
      throw new UnauthorizedException('Sign in to edit your studio location.');
    return user.userId;
  }

  private view(row?: Revision) {
    return row
      ? {
          version: row.version,
          profile: CreatorLocationProfileSchema.parse(row.profile),
          requestId: row.requestId,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { version: 0, profile: null, requestId: null, updatedAt: null };
  }

  async read(user: AuthUser) {
    const creatorId = this.subject(user);
    const rows = await this.prisma.$queryRaw<Revision[]>`
      SELECT version, expected_version AS "expectedVersion", request_id AS "requestId",
        profile, created_at AS "updatedAt"
      FROM creator_location_revisions WHERE creator_id = ${creatorId}
      ORDER BY version DESC LIMIT 1`;
    return this.view(rows[0]);
  }

  async save(user: AuthUser, raw: SaveCreatorLocationProfile) {
    const creatorId = this.subject(user);
    const parsed = SaveCreatorLocationProfileSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      // No local user row exists to lock: serialize first saves as well as updates.
      // Hash collisions only serialize unrelated owners; they cannot mix data.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-location:${creatorId}`}, 0))`;
      const [replay] = await tx.$queryRaw<Revision[]>`
        SELECT version, expected_version AS "expectedVersion", request_id AS "requestId",
          profile, created_at AS "updatedAt"
        FROM creator_location_revisions
        WHERE creator_id = ${creatorId} AND request_id = ${input.requestId}::uuid`;
      if (replay) {
        if (
          replay.expectedVersion !== input.expectedVersion ||
          JSON.stringify(CreatorLocationProfileSchema.parse(replay.profile)) !==
            JSON.stringify(input.profile)
        )
          throw new ConflictException(
            'This request ID was already used for different studio location edits.',
          );
        return this.view(replay);
      }
      const [latest] = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM creator_location_revisions WHERE creator_id = ${creatorId}
        ORDER BY version DESC LIMIT 1`;
      if ((latest?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'Your studio location changed. Refresh before saving your edits.',
        );
      const [saved] = await tx.$queryRaw<Revision[]>`
        INSERT INTO creator_location_revisions
          (id, creator_id, version, expected_version, request_id, profile)
        VALUES (${randomUUID()}::uuid, ${creatorId}, ${input.expectedVersion + 1},
          ${input.expectedVersion}, ${input.requestId}::uuid, ${JSON.stringify(input.profile)}::jsonb)
        RETURNING version, expected_version AS "expectedVersion", request_id AS "requestId",
          profile, created_at AS "updatedAt"`;
      return this.view(saved);
    });
  }
}

@Controller('creator-location/me')
export class CreatorLocationsController {
  constructor(private readonly service: CreatorLocationsService) {}

  @Get()
  async read(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.service.read(user) };
  }

  @Put()
  async save(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SaveCreatorLocationProfileSchema))
    input: SaveCreatorLocationProfile,
  ) {
    return { code: 200, data: await this.service.save(user, input) };
  }
}
