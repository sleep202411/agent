import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ArchiveProjectSchema,
  CreateProjectSchema,
  CreateTeamWorkspaceSchema,
  DeleteWorkspaceSchema,
  ProjectParamsSchema,
  UpdateProjectSchema,
  UpdateWorkspaceSchema,
  WorkspaceParamsSchema,
  type ArchiveProjectInput,
  type CreateProjectInput,
  type CreateTeamWorkspaceInput,
  type DeleteWorkspaceInput,
  type ProjectParams,
  type UpdateProjectInput,
  type UpdateWorkspaceInput,
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

  /**
   * Idempotent personal workspace bootstrap — called once when the user
   * first lands on the FizzStudio page. Safe to call multiple times:
   * returns the existing workspace if it already exists.
   * Intentionally a POST (not GET) because it has a write side effect.
   */
  @Post('workspaces/personal/ensure')
  async ensurePersonalWorkspace(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: await this.workspaces.ensureAndReturnPersonalWorkspace(user),
    };
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

  @Delete('workspaces/:workspaceId')
  async deleteWorkspace(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(WorkspaceParamsSchema))
    params: WorkspaceParams,
    @Body(new ZodValidationPipe(DeleteWorkspaceSchema))
    body: DeleteWorkspaceInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.deleteTeamWorkspace(
        user,
        params.workspaceId,
        body,
      ),
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

  @Delete('projects/:projectId')
  async archiveProject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParamsSchema)) params: ProjectParams,
    @Body(new ZodValidationPipe(ArchiveProjectSchema))
    body: ArchiveProjectInput,
  ) {
    return {
      code: 200,
      data: await this.workspaces.archiveProject(user, params.projectId, body),
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
