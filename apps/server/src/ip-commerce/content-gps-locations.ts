import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';

// Owner assertions are deliberately separate from AI/geocoder evidence. A future
// enrichment rerun must read this override, never replace it with model output.
const Base = {
  id: z.string().uuid(),
  kind: z.enum(['story_setting', 'production_origin']),
  label: z.string().trim().min(1).max(300),
};
const Point = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    coordinateSystem: z.enum(['WGS84', 'GCJ02']),
    precision: z.enum(['country', 'region', 'city', 'place']),
  })
  .strict();
export const OwnerLocationsSchema = z
  .array(
    z.discriminatedUnion('status', [
      z
        .object({ ...Base, status: z.literal('resolved'), point: Point })
        .strict(),
      z
        .object({
          ...Base,
          status: z.enum(['ambiguous', 'fictional', 'unresolved']),
          point: z.null(),
        })
        .strict(),
    ]),
  )
  .max(100)
  .refine(
    (locations) =>
      new Set(locations.map((location) => location.id)).size ===
      locations.length,
    'Location IDs must be unique.',
  );
export const SaveOwnerLocationsSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    // An explicit empty override means the owner removed all locations. It is not
    // the same as never having supplied an override (GET version 0).
    locations: OwnerLocationsSchema,
  })
  .strict();
type SaveInput = z.infer<typeof SaveOwnerLocationsSchema>;
type Revision = {
  version: number;
  locations: z.infer<typeof OwnerLocationsSchema>;
  requestId: string;
  expectedVersion: number;
  updatedById: string;
  updatedAt: Date;
};
const Params = z.object({ ipId: z.string().uuid() });

@Injectable()
export class ContentGpsLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owner(
    tx: Prisma.TransactionClient,
    ipId: string,
    user: AuthUser,
    write: boolean,
  ) {
    // Same IP row lock serializes saves and ownership/deletion changes. Editors,
    // Crew members and administrators do not inherit the owner's correction right.
    const rows = write
      ? await tx.$queryRaw<{ createdById: string }[]>`
        SELECT created_by_id AS "createdById" FROM ips
        WHERE id = ${ipId}::uuid AND deleted_at IS NULL FOR UPDATE`
      : await tx.$queryRaw<{ createdById: string }[]>`
        SELECT created_by_id AS "createdById" FROM ips
        WHERE id = ${ipId}::uuid AND deleted_at IS NULL FOR SHARE`;
    if (!user?.userId || rows[0]?.createdById !== user.userId)
      throw new NotFoundException('IP not found.');
  }

  private view(row?: Revision) {
    return row
      ? {
          version: row.version,
          locations: row.locations,
          requestId: row.requestId,
          updatedById: row.updatedById,
          updatedAt: row.updatedAt.toISOString(),
        }
      : {
          version: 0,
          locations: null,
          requestId: null,
          updatedById: null,
          updatedAt: null,
        };
  }

  async read(ipId: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.owner(tx, ipId, user, false);
      const rows = await tx.$queryRaw<Revision[]>`
        SELECT version, locations, request_id AS "requestId", expected_version AS "expectedVersion",
          updated_by_id AS "updatedById", created_at AS "updatedAt"
        FROM ip_content_gps_location_revisions WHERE ip_id = ${ipId}::uuid
        ORDER BY version DESC LIMIT 1`;
      return this.view(rows[0]);
    });
  }

  async save(ipId: string, user: AuthUser, raw: SaveInput) {
    const parsed = SaveOwnerLocationsSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      await this.owner(tx, ipId, user, true);
      const replay = await tx.$queryRaw<Revision[]>`
        SELECT version, locations, request_id AS "requestId", expected_version AS "expectedVersion",
          updated_by_id AS "updatedById", created_at AS "updatedAt"
        FROM ip_content_gps_location_revisions
        WHERE ip_id = ${ipId}::uuid AND request_id = ${input.requestId}::uuid`;
      if (replay[0]) {
        const saved = replay[0];
        if (
          saved.updatedById !== user.userId ||
          saved.expectedVersion !== input.expectedVersion ||
          JSON.stringify(OwnerLocationsSchema.parse(saved.locations)) !==
            JSON.stringify(input.locations)
        )
          throw new ConflictException(
            'This request ID was already used for different location edits.',
          );
        return this.view(saved);
      }
      const [current] = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM ip_content_gps_location_revisions WHERE ip_id = ${ipId}::uuid
        ORDER BY version DESC LIMIT 1`;
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'IP locations changed. Refresh before saving your edits.',
        );
      const [saved] = await tx.$queryRaw<Revision[]>`
        INSERT INTO ip_content_gps_location_revisions
          (id, ip_id, version, expected_version, request_id, locations, updated_by_id)
        VALUES (${randomUUID()}::uuid, ${ipId}::uuid, ${input.expectedVersion + 1},
          ${input.expectedVersion}, ${input.requestId}::uuid, ${JSON.stringify(input.locations)}::jsonb, ${user.userId})
        RETURNING version, locations, request_id AS "requestId", expected_version AS "expectedVersion",
          updated_by_id AS "updatedById", created_at AS "updatedAt"`;
      return this.view(saved);
    });
  }
}

@Controller('ip-commerce/me/ips/:ipId/content-gps/locations')
export class ContentGpsLocationsController {
  constructor(private readonly locations: ContentGpsLocationsService) {}

  @Get()
  async read(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
  ) {
    return { code: 200, data: await this.locations.read(params.ipId, user) };
  }

  @Put()
  async save(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SaveOwnerLocationsSchema)) input: SaveInput,
  ) {
    return {
      code: 200,
      data: await this.locations.save(params.ipId, user, input),
    };
  }
}
