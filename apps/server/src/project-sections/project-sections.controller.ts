import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ArchiveProjectSectionSchema,
  CreateProjectSectionSchema,
  ProjectSectionParamsSchema,
  ProjectSectionsParamsSchema,
  ReorderProjectSectionsSchema,
  UpdateProjectSectionSchema,
  type ArchiveProjectSectionInput,
  type CreateProjectSectionInput,
  type ProjectSectionParams,
  type ProjectSectionsParams,
  type ReorderProjectSectionsInput,
  type UpdateProjectSectionInput,
} from './dto';
import { ProjectSectionsService } from './project-sections.service';

@Controller('projects/:projectId/sections')
export class ProjectSectionsController {
  constructor(private readonly sections: ProjectSectionsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectSectionsParamsSchema))
    params: ProjectSectionsParams,
  ) {
    return {
      code: 200,
      data: await this.sections.list(user, params.projectId),
    };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectSectionsParamsSchema))
    params: ProjectSectionsParams,
    @Body(new ZodValidationPipe(CreateProjectSectionSchema))
    body: CreateProjectSectionInput,
  ) {
    return {
      code: 200,
      data: await this.sections.create(user, params.projectId, body),
    };
  }

  @Put('order')
  async reorder(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectSectionsParamsSchema))
    params: ProjectSectionsParams,
    @Body(new ZodValidationPipe(ReorderProjectSectionsSchema))
    body: ReorderProjectSectionsInput,
  ) {
    return {
      code: 200,
      data: await this.sections.reorder(user, params.projectId, body),
    };
  }

  @Patch(':sectionId')
  async update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectSectionParamsSchema))
    params: ProjectSectionParams,
    @Body(new ZodValidationPipe(UpdateProjectSectionSchema))
    body: UpdateProjectSectionInput,
  ) {
    return {
      code: 200,
      data: await this.sections.update(
        user,
        params.projectId,
        params.sectionId,
        body,
      ),
    };
  }

  @Post(':sectionId/archive')
  async archive(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectSectionParamsSchema))
    params: ProjectSectionParams,
    @Body(new ZodValidationPipe(ArchiveProjectSectionSchema))
    body: ArchiveProjectSectionInput,
  ) {
    return {
      code: 200,
      data: await this.sections.archive(
        user,
        params.projectId,
        params.sectionId,
        body,
      ),
    };
  }
}
