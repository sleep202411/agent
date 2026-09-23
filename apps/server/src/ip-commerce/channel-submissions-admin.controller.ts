import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  AdminAuthService,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ChannelSubmissionDecision,
  ChannelSubmissionsService,
} from './channel-submissions';
const Params = z.object({ ipId: z.string().uuid() });
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce/ips/:ipId/submissions')
export class ChannelSubmissionsAdminController {
  constructor(
    private readonly submissions: ChannelSubmissionsService,
    private readonly auth: AdminAuthService,
  ) {}
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Get()
  async list(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @Query(
      new ZodValidationPipe(z.object({ cursor: z.string().uuid().optional() })),
    )
    query: { cursor?: string },
  ) {
    return {
      code: 200,
      data: await this.submissions.list(
        p.ipId,
        { userId: admin.id },
        undefined,
        query.cursor,
        true,
      ),
    };
  }
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch()
  async decide(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(ChannelSubmissionDecision))
    body: z.infer<typeof ChannelSubmissionDecision>,
  ) {
    const data = await this.submissions.decide(
      p.ipId,
      { userId: admin.id },
      body,
      true,
    );
    await this.auth.writeAudit({
      actor: admin,
      action: 'admin.ip.submission.review',
      resourceType: 'ip',
      resourceId: p.ipId,
      metadata: body,
    });
    return { code: 200, data };
  }
}
