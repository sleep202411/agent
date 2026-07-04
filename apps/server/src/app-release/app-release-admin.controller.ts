import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../admin-auth';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateAppReleaseSchema,
  ListAppReleasesQuerySchema,
  UpdateAppReleaseSchema,
  type CreateAppReleaseInput,
  type ListAppReleasesQuery,
  type UpdateAppReleaseInput,
} from './dto';
import { AppReleaseService } from './app-release.service';

/**
 * /admin/app-releases — mobile version manifest CRUD. Gated by `admin.manage`:
 * announcing a release (and the force-update floor) is a platform-config
 * concern, not day-to-day operations.
 *
 * `@Public()` skips the end-user (Java satoken) AuthGuard — admin traffic
 * carries an `fd_admin_session`, not a satoken, so without this the global
 * AuthGuard 401s every request before AdminAuthGuard runs. Access is gated
 * instead by the admin guards below (same pattern as every admin controller).
 */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/app-releases')
export class AppReleaseAdminController {
  constructor(private readonly service: AppReleaseService) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AdminManage)
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAppReleasesQuerySchema))
    query: ListAppReleasesQuery,
  ) {
    return {
      code: 200,
      data: { items: await this.service.listAdmin(query.platform) },
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AdminManage)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateAppReleaseSchema))
    body: CreateAppReleaseInput,
  ) {
    return { code: 200, data: await this.service.create(body) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AdminManage)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateAppReleaseSchema))
    body: UpdateAppReleaseInput,
  ) {
    return { code: 200, data: await this.service.update(id, body) };
  }
}
