import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SkipEndUserAuth } from '../auth';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  ADMIN_PERMISSION_KEYS,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CourseId } from './academy-authority.service';
import {
  AcademyMappingsService,
  SaveCourseCertificate,
  CertificateCoursesQuery,
} from './academy-mappings.service';

@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/academy/course-certificates')
export class AcademyAdminController {
  constructor(private readonly mappings: AcademyMappingsService) {}

  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  @Header('Cache-Control', 'private, no-store')
  async index(
    @CurrentAdmin() admin: AdminActor,
    @Query('courseIds') courseIds?: string,
  ) {
    const ids = (courseIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => CourseId.safeParse(id).success);
    return { code: 200, data: await this.mappings.index(admin, ids) };
  }

  @Get(':courseId')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentAdmin() admin: AdminActor,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
  ) {
    return { code: 200, data: await this.mappings.editor(admin, id) };
  }

  @Put(':courseId')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesWrite)
  @Header('Cache-Control', 'private, no-store')
  async save(
    @CurrentAdmin() admin: AdminActor,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
    @Body(new ZodValidationPipe(SaveCourseCertificate))
    input: z.infer<typeof SaveCourseCertificate>,
  ) {
    return { code: 200, data: await this.mappings.save(admin, id, input) };
  }
}

@SkipEndUserAuth()
@Controller('academy')
export class AcademyPublicController {
  constructor(private readonly mappings: AcademyMappingsService) {}

  @Get('course-certificates/:courseId')
  @Header('Cache-Control', 'no-store')
  async get(@Param('courseId', new ZodValidationPipe(CourseId)) id: string) {
    return { code: 200, data: await this.mappings.published(id) };
  }

  @Get('certificates/:certificateId/courses')
  @Header('Cache-Control', 'no-store')
  async courses(
    @Param(
      'certificateId',
      new ZodValidationPipe(z.coerce.number().int().positive().safe()),
    )
    certificateId: number,
    @Query(new ZodValidationPipe(CertificateCoursesQuery))
    query: z.infer<typeof CertificateCoursesQuery>,
  ) {
    return {
      code: 200,
      data: await this.mappings.courses(certificateId, query),
    };
  }
}
