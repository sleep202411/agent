import { ServiceTokenGuard } from '../internal/service-token.guard';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SkipEndUserAuth, type AuthUser } from '../auth';
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
import { AcademyLearningService } from './academy-learning.service';
import {
  Enroll,
  LearningPage,
  ReviewHomework,
  SaveOffering,
  SubmitHomework,
} from './academy-learning.dto';

@Controller('academy/learning')
export class AcademyLearningController {
  constructor(private readonly learning: AcademyLearningService) {}
  @Header('Cache-Control', 'private, no-store')
  @Get('courses/:courseId')
  async offering(
    @CurrentUser() user: AuthUser,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
  ) {
    return { code: 200, data: await this.learning.offering(id, user.userId) };
  }
  @Post('courses/:courseId/enroll')
  async enroll(
    @CurrentUser() user: AuthUser,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
    @Body(new ZodValidationPipe(Enroll)) body: z.infer<typeof Enroll>,
  ) {
    return {
      code: 200,
      data: await this.learning.enroll(id, user.userId, body.expectedVersion),
    };
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('enrollments')
  async mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(LearningPage))
    query: z.infer<typeof LearningPage>,
  ) {
    return {
      code: 200,
      data: await this.learning.list(user.userId, false, query.after),
    };
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('teaching/summary')
  async summary(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: await this.learning.teachingSummary(user.userId),
    };
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('teaching')
  async teaching(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(LearningPage))
    query: z.infer<typeof LearningPage>,
  ) {
    return {
      code: 200,
      data: await this.learning.list(user.userId, true, query.after),
    };
  }
  @Post('enrollments/:id/submit')
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(SubmitHomework))
    body: z.infer<typeof SubmitHomework>,
  ) {
    return {
      code: 200,
      data: await this.learning.submit(id, user.userId, body),
    };
  }
  @Post('enrollments/:id/review')
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(ReviewHomework))
    body: z.infer<typeof ReviewHomework>,
  ) {
    return {
      code: 200,
      data: await this.learning.review(id, user.userId, body),
    };
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('enrollments/:id/attachments/:assetId')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Param('assetId', new ZodValidationPipe(z.uuid())) assetId: string,
  ) {
    return {
      code: 200,
      data: await this.learning.attachment(id, assetId, user.userId),
    };
  }
}

@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/academy/offerings')
export class AcademyOfferingController {
  constructor(private readonly learning: AcademyLearningService) {}
  @Header('Cache-Control', 'private, no-store')
  @Get(':courseId')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  async get(
    @CurrentAdmin() admin: AdminActor,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
  ) {
    return { code: 200, data: await this.learning.editor(admin, id) };
  }
  @Put(':courseId')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesWrite)
  async save(
    @CurrentAdmin() admin: AdminActor,
    @Param('courseId', new ZodValidationPipe(CourseId)) id: string,
    @Body(new ZodValidationPipe(SaveOffering))
    input: z.infer<typeof SaveOffering>,
  ) {
    return { code: 200, data: await this.learning.configure(admin, id, input) };
  }
}

@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/academy/learning')
export class AcademyLearningAdminController {
  constructor(private readonly learning: AcademyLearningService) {}

  @Header('Cache-Control', 'private, no-store')
  @Get('homework')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  async homework(
    @CurrentAdmin() admin: AdminActor,
    @Query(
      new ZodValidationPipe(
        z.strictObject({
          after: z.uuid().optional(),
          status: z.enum(['submitted', 'all']).default('submitted'),
        }),
      ),
    )
    query: { after?: string; status: 'submitted' | 'all' },
  ) {
    return {
      code: 200,
      data: await this.learning.adminHomework(admin, query.after, query.status),
    };
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('income')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  async income(@CurrentAdmin() admin: AdminActor) {
    return { code: 200, data: await this.learning.adminIncomeSummary(admin) };
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('courses')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  async courses(@CurrentAdmin() admin: AdminActor) {
    return { code: 200, data: await this.learning.adminTeachingCourses(admin) };
  }

  @Post('enrollments/:id/review')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesWrite)
  async review(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(ReviewHomework))
    body: z.infer<typeof ReviewHomework>,
  ) {
    return {
      code: 200,
      data: await this.learning.adminReview(admin, id, body),
    };
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('enrollments/:id/attachments/:assetId')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CoursesRead)
  async attachment(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Param('assetId', new ZodValidationPipe(z.uuid())) assetId: string,
  ) {
    return {
      code: 200,
      data: await this.learning.adminAttachment(admin, id, assetId),
    };
  }
}

@SkipEndUserAuth()
@UseGuards(ServiceTokenGuard)
@Controller('internal/academy')
export class AcademyAccessController {
  constructor(private readonly learning: AcademyLearningService) {}
  @Post('access')
  async access(
    @Body(
      new ZodValidationPipe(
        z.strictObject({
          courseId: CourseId,
          userId: z
            .string()
            .regex(/^[1-9]\d{0,17}$/)
            .nullable(),
        }),
      ),
    )
    input: {
      courseId: string;
      userId: string | null;
    },
  ) {
    return {
      code: 200,
      data: await this.learning.playbackAccess(input.courseId, input.userId),
    };
  }
}
