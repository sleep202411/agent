import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExperienceStableIdSchema } from '@repo/shared/experience-runtime';
import { z } from 'zod';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { SkipEndUserAuth } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryPublicationAdminService } from './story-publication-admin.service';

const GameParamsSchema = z
  .object({ gameId: ExperienceStableIdSchema })
  .strict();
const VersionQuerySchema = z
  .object({ contentVersion: ExperienceStableIdSchema })
  .strict();

// Admin credentials bypass the creator-session lookup. Both admin guards are
// mandatory, so pending introductions never enter the anonymous store route.
@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/story-publications')
export class StoryPublicationAdminController {
  constructor(private readonly publications: StoryPublicationAdminService) {}

  @Get(':gameId/listing')
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  async listing(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(GameParamsSchema))
    params: z.infer<typeof GameParamsSchema>,
    @Query(new ZodValidationPipe(VersionQuerySchema))
    query: z.infer<typeof VersionQuerySchema>,
  ) {
    return {
      code: 200,
      data: await this.publications.listing(
        admin,
        params.gameId,
        query.contentVersion,
      ),
    };
  }
}
