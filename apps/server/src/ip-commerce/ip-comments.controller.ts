import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public, CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { IpCommentsService } from './ip-comments.service';
const Params = z.object({
  ipId: z.string().uuid(),
  id: z.string().uuid().optional(),
});
const Create = z
  .object({
    body: z.string().trim().min(1).max(2000),
    requestId: z.string().uuid(),
  })
  .strict();
@Controller('ip-commerce/ips/:ipId/comments')
export class IpCommentsController {
  constructor(private readonly comments: IpCommentsService) {}
  @Public()
  @Get()
  list(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser | undefined,
    @Query(
      new ZodValidationPipe(
        z.object({ cursor: z.string().uuid().optional() }).strict(),
      ),
    )
    query: { cursor?: string },
  ) {
    return this.comments.list(params.ipId, user, query.cursor);
  }
  @Post()
  create(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Create)) input: z.infer<typeof Create>,
  ) {
    return this.comments.create(params.ipId, user, input);
  }
  @Delete(':id')
  remove(
    @Param(new ZodValidationPipe(Params.extend({ id: z.string().uuid() })))
    params: { ipId: string; id: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.remove(params.ipId, params.id, user);
  }
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce/ips/:ipId/comments')
export class IpCommentsAdminController {
  constructor(private readonly comments: IpCommentsService) {}
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Delete(':id')
  remove(
    @Param(new ZodValidationPipe(Params.extend({ id: z.string().uuid() })))
    params: { ipId: string; id: string },
    @CurrentAdmin() admin: AdminActor,
    @Body(
      new ZodValidationPipe(
        z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
      ),
    )
    input: { reason: string },
  ) {
    return this.comments.moderate(
      params.ipId,
      params.id,
      admin.id,
      input.reason,
    );
  }
}
