import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AiActorsService } from './ai-actors.service';
import { AI_ACTOR_CATEGORIES } from './ai-actors.types';
const page = z.coerce.number().int().min(1).max(100000).default(1);
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({ workspaceId: z.string().uuid(), page });
const unlockSchema = z.object({ workspaceId: z.string().uuid() });
const useSchema = z.object({
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
});
const saveSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(64),
    photoAssetId: z.string().uuid(),
    active: z.boolean(),
    category: z.enum(AI_ACTOR_CATEGORIES).default('ai_actor'),
  })
  .strict();
@Controller('ai-actors')
export class AiActorsController {
  constructor(private readonly service: AiActorsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    return {
      code: 200,
      data: await this.service.list(user.userId, query.workspaceId, query.page),
    };
  }
  @Post(':id/unlock')
  async unlock(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(idSchema)) params: z.infer<typeof idSchema>,
    @Body(new ZodValidationPipe(unlockSchema))
    body: z.infer<typeof unlockSchema>,
  ) {
    return {
      code: 200,
      data: await this.service.unlock(user.userId, params.id, body.workspaceId),
    };
  }
  @Post(':id/use')
  async use(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(idSchema)) params: z.infer<typeof idSchema>,
    @Body(new ZodValidationPipe(useSchema)) body: z.infer<typeof useSchema>,
  ) {
    return {
      code: 200,
      data: await this.service.use(
        user.userId,
        params.id,
        body.projectId,
        body.requestId,
      ),
    };
  }
}
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ai-actors')
export class AdminAiActorsController {
  constructor(private readonly service: AiActorsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiActorsRead)
  async list(
    @Query(
      new ZodValidationPipe(
        z.object({
          page,
          category: z.enum(AI_ACTOR_CATEGORIES).optional(),
        }),
      ),
    )
    query: {
      page: number;
      category?: (typeof AI_ACTOR_CATEGORIES)[number];
    },
  ) {
    return {
      code: 200,
      data: await this.service.adminList(query.page, query.category),
    };
  }
  @Post()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiActorsWrite)
  async save(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(saveSchema)) body: z.infer<typeof saveSchema>,
  ) {
    return { code: 200, data: await this.service.save(admin, body) };
  }
  @Get(':id/usage')
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiActorsRead)
  async usage(
    @Param(new ZodValidationPipe(idSchema)) params: { id: string },
    @Query(new ZodValidationPipe(z.object({ page }))) query: { page: number },
  ) {
    return { code: 200, data: await this.service.usage(params.id, query.page) };
  }

  @Delete(':id')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AiActorsWrite)
  async archive(
    @Param(new ZodValidationPipe(idSchema)) params: { id: string },
  ) {
    return { code: 200, data: await this.service.archive(params.id) };
  }
}
