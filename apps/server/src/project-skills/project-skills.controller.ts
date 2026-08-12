import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectSkillScope } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth';
import {
  DeleteProjectSkillBodySchema,
  InstallProjectSkillBodySchema,
  ImportProjectSkillBodySchema,
  ProjectSkillOwnerKindSchema,
  SetProjectSkillDefaultsBodySchema,
  UpdateProjectSkillBodySchema,
  type ProjectSkillOwnerKind,
} from './project-skills.dto';
import {
  PROJECT_SKILL_UPLOAD_MAX_BYTES,
  type UploadedProjectSkillFile,
} from './project-skill-package';
import { ProjectSkillsService } from './project-skills.service';

@Controller()
export class ProjectSkillsController {
  constructor(private readonly skills: ProjectSkillsService) {}

  @Get('skills')
  async catalog(
    @CurrentUser() user: AuthUser,
    @Query('ownerKind') ownerKindRaw?: string,
    @Query('projectId') projectId?: string,
    @Query('kind') kind?: string,
    @Query('capability') capability?: string,
    @Query('q') query?: string,
  ) {
    const ownerKind = parseOwnerKind(ownerKindRaw);
    const parsedProjectId = parseUuid(projectId, 'projectId');
    return {
      code: 200,
      data: await this.skills.listCatalog(user, ownerKind, parsedProjectId, {
        kind,
        capability,
        query,
      }),
    };
  }

  @Get('project-skills/:ownerKind/:projectId/installations')
  async installations(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return {
      code: 200,
      data: await this.skills.listInstallations(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
      ),
    };
  }

  @Post('project-skills/:ownerKind/:projectId/installations')
  async install(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId?: string,
  ) {
    return {
      code: 200,
      data: await this.skills.install(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        parseBody(InstallProjectSkillBodySchema, body),
        requestId,
      ),
    };
  }

  @Post('project-skills/:ownerKind/:projectId/catalog/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: PROJECT_SKILL_UPLOAD_MAX_BYTES },
    }),
  )
  async importSkill(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedProjectSkillFile | undefined,
    @Headers('x-request-id') requestId?: string,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'PROJECT_SKILL_PACKAGE_REQUIRED',
        msg: 'Select a SKILL.md file or ZIP package to upload.',
      });
    }
    return {
      code: 200,
      data: await this.skills.importAndInstall(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        parseBody(ImportProjectSkillBodySchema, body),
        file,
        requestId,
      ),
    };
  }

  @Patch('project-skills/:ownerKind/:projectId/installations/:installationId')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId?: string,
  ) {
    return {
      code: 200,
      data: await this.skills.update(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        installationId,
        parseBody(UpdateProjectSkillBodySchema, body),
        requestId,
      ),
    };
  }

  @Delete('project-skills/:ownerKind/:projectId/installations/:installationId')
  async uninstall(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId?: string,
  ) {
    return {
      code: 200,
      data: await this.skills.uninstall(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        installationId,
        parseBody(DeleteProjectSkillBodySchema, body),
        requestId,
      ),
    };
  }

  @Put('project-skills/:ownerKind/:projectId/defaults/:scope')
  async defaults(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scope') scopeRaw: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId?: string,
  ) {
    return {
      code: 200,
      data: await this.skills.setDefaults(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        parseScope(scopeRaw),
        parseBody(SetProjectSkillDefaultsBodySchema, body),
        requestId,
      ),
    };
  }

  @Get('project-skills/:ownerKind/:projectId/effective')
  async effective(
    @CurrentUser() user: AuthUser,
    @Param('ownerKind') ownerKindRaw: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('scope') scopeRaw?: string,
    @Query('workbenchMode') workbenchMode?: string,
    @Query('sourceSurface') sourceSurface?: string,
  ) {
    return {
      code: 200,
      data: await this.skills.getEffective(
        user,
        parseOwnerKind(ownerKindRaw),
        projectId,
        parseScope(scopeRaw),
        workbenchMode,
        sourceSurface,
      ),
    };
  }
}

function parseOwnerKind(value: string | undefined): ProjectSkillOwnerKind {
  const parsed = ProjectSkillOwnerKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'PROJECT_SKILL_OWNER_KIND_INVALID',
      msg: 'ownerKind must be platform or story.',
    });
  }
  return parsed.data;
}

function parseScope(value: string | undefined): ProjectSkillScope {
  if (
    !value ||
    !Object.values(ProjectSkillScope).includes(value as ProjectSkillScope)
  ) {
    throw new BadRequestException({
      code: 'PROJECT_SKILL_SCOPE_INVALID',
      msg: 'A valid project Skill scope is required.',
    });
  }
  return value as ProjectSkillScope;
}

function parseUuid(value: string | undefined, field: string): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BadRequestException({
      code: 'PROJECT_SKILL_PROJECT_ID_INVALID',
      msg: `${field} must be a UUID.`,
    });
  }
  return value;
}

function parseBody<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { message: string } };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'PROJECT_SKILL_BODY_INVALID',
      msg: parsed.error.message,
    });
  }
  return parsed.data;
}
