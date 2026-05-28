import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateProjectSchema,
  CreateTeamWorkspaceSchema,
  ListLegacyProjectMappingsQuerySchema,
  ProjectParamsSchema,
  UpdateProjectSchema,
  UpdateWorkspaceSchema,
  UpsertLegacyProjectMappingSchema,
  WorkspaceParamsSchema,
  type CreateProjectInput,
  type CreateTeamWorkspaceInput,
  type ListLegacyProjectMappingsQuery,
  type ProjectParams,
  type UpdateProjectInput,
  type UpdateWorkspaceInput,
  type UpsertLegacyProjectMappingInput,
  type WorkspaceParams,
} from './dto';
import { WorkspacesService } from './workspaces.service';

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('workspaces')
  async listWorkspaces(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.workspaces.listForUser(user) };
  }

  @Post('workspaces/team')
  async createTeamWorkspace(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateTeamWorkspaceSchema))
    body: CreateTeamWorkspaceInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.createTeamWorkspace(user, body),
    };
  }

  @Get('workspaces/:workspaceId')
  async getWorkspace(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
  ) {
    return {
      code: 200,
      data: await this.workspaces.getWorkspace(user, params.workspaceId),
    };
  }

  @Patch('workspaces/:workspaceId')
  async updateWorkspace(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema))
    body: UpdateWorkspaceInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.updateWorkspace(
        user,
        params.workspaceId,
        body,
      ),
    };
  }

  @Get('workspaces/:workspaceId/projects')
  async listProjects(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
  ) {
    return {
      code: 200,
      data: await this.workspaces.listProjects(user, params.workspaceId),
    };
  }

  @Post('workspaces/:workspaceId/projects')
  async createProject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: CreateProjectInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.createProject(user, params.workspaceId, body),
    };
  }

  @Get('workspaces/:workspaceId/legacy-projects')
  async listLegacyProjectMappings(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
    @Query(new ZodValidationPipe(ListLegacyProjectMappingsQuerySchema))
    query: ListLegacyProjectMappingsQuery,
  ) {
    return {
      code: 200,
      data: await this.workspaces.listLegacyProjectMappings(
        user,
        params.workspaceId,
        query,
      ),
    };
  }

  @Post('workspaces/:workspaceId/legacy-projects')
  async upsertLegacyProjectMapping(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
    @Body(new ZodValidationPipe(UpsertLegacyProjectMappingSchema))
    body: UpsertLegacyProjectMappingInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.upsertLegacyProjectMapping(
        user,
        params.workspaceId,
        body,
      ),
    };
  }

  @Get('legacy-projects')
  async listLegacyProjectMappingsForUser(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListLegacyProjectMappingsQuerySchema))
    query: ListLegacyProjectMappingsQuery,
  ) {
    return {
      code: 200,
      data: await this.workspaces.listLegacyProjectMappingsForUser(user, query),
    };
  }

  @Post('legacy-projects/personal')
  async ensurePersonalLegacyProjectMapping(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpsertLegacyProjectMappingSchema))
    body: UpsertLegacyProjectMappingInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.ensurePersonalLegacyProjectMapping(
        user,
        body,
      ),
    };
  }

  @Get('projects/:projectId')
  async getProject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParamsSchema)) params: ProjectParams,
  ) {
    return {
      code: 200,
      data: await this.workspaces.getProject(user, params.projectId),
    };
  }

  @Patch('projects/:projectId')
  async updateProject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParamsSchema)) params: ProjectParams,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) body: UpdateProjectInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.updateProject(user, params.projectId, body),
    };
  }
}
