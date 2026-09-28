import { TaskTemplateDefinitionSchema } from './project-task-template.schema';
import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../../admin-auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { z } from 'zod';
import { CrewProductionKind } from '@prisma/client';
import { ProjectTaskTemplateService } from './project-task-template.service';
import {
  PlotTreeSchema,
  type PlotTreeImportInput,
} from './project-task-template.types';

const ListQuerySchema = z.object({
  projectType: z.nativeEnum(CrewProductionKind).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const ParamsSchema = z.object({
  projectType: z.nativeEnum(CrewProductionKind),
});

const SaveBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    definition: TaskTemplateDefinitionSchema,
  })
  .strict();

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/project-task-templates')
export class ProjectTaskTemplatesAdminController {
  constructor(private readonly service: ProjectTaskTemplateService) {}

  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema))
    query: z.infer<typeof ListQuerySchema>,
  ) {
    return { code: 200, data: await this.service.listAllAdmin(query) };
  }

  @Put(':projectType')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async save(
    @Param(new ZodValidationPipe(ParamsSchema))
    params: z.infer<typeof ParamsSchema>,
    @Body(new ZodValidationPipe(SaveBodySchema))
    body: z.infer<typeof SaveBodySchema>,
  ) {
    return {
      code: 200,
      data: await this.service.saveAdmin({
        projectType: params.projectType,
        name: body.name,
        definition: body.definition,
      }),
    };
  }
  @Post('import/plot-tree')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async importPlotTree(
    @Body(new ZodValidationPipe(PlotTreeSchema))
    body: PlotTreeImportInput,
  ) {
    return {
      code: 200,
      data: await this.service.importPlotTree(body),
    };
  }
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/task-templates')
export class TaskTemplatesAdminAliasController {
  constructor(private readonly service: ProjectTaskTemplateService) {}

  @Post('import/plot-tree')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  async importPlotTree(
    @Body(new ZodValidationPipe(PlotTreeSchema))
    body: PlotTreeImportInput,
  ) {
    return {
      code: 200,
      data: await this.service.importPlotTree(body),
    };
  }
}
