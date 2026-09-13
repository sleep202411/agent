import {
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
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';

export const ReleaseLinksSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(1).max(80),
        url: z
          .string()
          .trim()
          .url()
          .max(2000)
          .refine((value) => {
            try {
              const url = new URL(value);
              return (
                url.protocol === 'https:' && !url.username && !url.password
              );
            } catch {
              return false;
            }
          }, 'Use an HTTPS link without embedded credentials.'),
      })
      .strict(),
  )
  .max(20)
  .refine(
    (items) => new Set(items.map((item) => item.url)).size === items.length,
    'Remove duplicate release links.',
  );
type Links = z.infer<typeof ReleaseLinksSchema>;
const Params = z.object({ ipId: z.string().uuid() });
const Save = z
  .object({
    links: ReleaseLinksSchema,
    expectedVersion: z.number().int().min(0),
  })
  .strict();

@Injectable()
export class IpReleaseLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  private async read(ipId: string) {
    const [row] = await this.prisma.$queryRaw<
      { links: Links; version: number }[]
    >`SELECT release_links AS links, version FROM ips WHERE id = ${ipId}::uuid`;
    if (!row) throw new NotFoundException('IP not found');
    return row;
  }
  async publicList(ipId: string, user?: AuthUser) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    return { links: (await this.read(ipId)).links };
  }
  async ownList(ipId: string, user: AuthUser) {
    await this.ips.requireEditableIp(user, ipId);
    return this.read(ipId);
  }
  async save(ipId: string, user: AuthUser, input: z.infer<typeof Save>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)`;
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE`;
      await this.ips.requireEditableIp(user, ipId, tx);
      const rows = await tx.$queryRaw<{ links: Links; version: number }[]>`
        UPDATE ips SET release_links = ${JSON.stringify(input.links)}::jsonb, version = version + 1, updated_at = now(), updated_by_id = ${user.userId}
        WHERE id = ${ipId}::uuid AND version = ${input.expectedVersion}
        RETURNING release_links AS links, version
      `;
      if (!rows[0])
        throw new ConflictException(
          'This IP was updated elsewhere. Refresh and try again.',
        );
      return rows[0];
    });
  }
}
@Controller('ip-commerce')
export class IpReleaseLinksController {
  constructor(private readonly links: IpReleaseLinksService) {}
  @Public()
  @Get('ips/:ipId/release-links')
  publicList(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.links.publicList(params.ipId, user);
  }
  @Get('me/ips/:ipId/release-links')
  ownList(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.links.ownList(params.ipId, user);
  }
  @Put('me/ips/:ipId/release-links')
  save(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Save)) input: z.infer<typeof Save>,
  ) {
    return this.links.save(params.ipId, user, input);
  }
}
