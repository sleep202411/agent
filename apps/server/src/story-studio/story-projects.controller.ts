import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ArchiveStoryProjectSchema,
  CreateStoryChapterSchema,
  CreateStoryProjectSchema,
  LockStoryRevisionSchema,
  PatchStoryProjectSchema,
  PatchStoryChapterSchema,
  PutStoryCanvasLayoutSchema,
  PutStoryDraftSchema,
  StoryProjectIdParamsSchema,
  StoryChapterParamsSchema,
  StoryProjectListQuerySchema,
  StoryRevisionListQuerySchema,
  StoryRevisionParamsSchema,
  StoryUuidSchema,
  StoryWorkbenchQuerySchema,
  ReorderStoryChaptersSchema,
  type ArchiveStoryProjectInput,
  type CreateStoryChapterInput,
  type CreateStoryProjectInput,
  type LockStoryRevisionInput,
  type PatchStoryProjectInput,
  type PatchStoryChapterInput,
  type PutStoryCanvasLayoutInput,
  type PutStoryDraftInput,
  type StoryProjectIdParams,
  type StoryChapterParams,
  type StoryProjectListQuery,
  type StoryRevisionListQuery,
  type StoryRevisionParams,
  type StoryWorkbenchQuery,
  type ReorderStoryChaptersInput,
} from './dto';
import { StoryProjectsService } from './story-projects.service';

@Controller('story-projects')
export class StoryProjectsController {
  constructor(private readonly storyProjects: StoryProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Body(new ZodValidationPipe(CreateStoryProjectSchema))
    body: CreateStoryProjectInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.create(user, workspaceId, body),
    };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Query(new ZodValidationPipe(StoryProjectListQuerySchema))
    query: StoryProjectListQuery,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.list(user, workspaceId, query),
    };
  }

  @Post(':projectId/chapters')
  @HttpCode(HttpStatus.CREATED)
  async createChapter(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CreateStoryChapterSchema))
    body: CreateStoryChapterInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.createChapter(
        user,
        workspaceId,
        params.projectId,
        body,
      ),
    };
  }

  @Patch(':projectId/chapters/:chapterId')
  async patchChapter(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PatchStoryChapterSchema))
    body: PatchStoryChapterInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.patchChapter(
        user,
        workspaceId,
        params.projectId,
        params.chapterId,
        body,
      ),
    };
  }

  @Put(':projectId/chapters/order')
  async reorderChapters(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(ReorderStoryChaptersSchema))
    body: ReorderStoryChaptersInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.reorderChapters(
        user,
        workspaceId,
        params.projectId,
        body,
      ),
    };
  }

  @Post(':projectId/chapters/:chapterId/archive')
  async archiveChapter(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.archiveChapter(
        user,
        workspaceId,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Put(':projectId/chapters/:chapterId/draft')
  async putChapterDraft(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PutStoryDraftSchema))
    body: PutStoryDraftInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.putDraft(
        user,
        workspaceId,
        params.projectId,
        body,
        params.chapterId,
      ),
    };
  }

  @Get(':projectId/chapters/:chapterId/canvas-layout')
  async getChapterCanvasLayout(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.getCanvasLayout(
        user,
        workspaceId,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Put(':projectId/chapters/:chapterId/canvas-layout')
  async putChapterCanvasLayout(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PutStoryCanvasLayoutSchema))
    body: PutStoryCanvasLayoutInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.putCanvasLayout(
        user,
        workspaceId,
        params.projectId,
        body,
        params.chapterId,
      ),
    };
  }

  @Get(':projectId/workbench')
  async workbench(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryWorkbenchQuerySchema))
    query: StoryWorkbenchQuery,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.workbench(
        user,
        workspaceId,
        params.projectId,
        query,
      ),
    };
  }

  @Get(':projectId/revisions')
  async listRevisions(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryRevisionListQuerySchema))
    query: StoryRevisionListQuery,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.listRevisions(
        user,
        workspaceId,
        params.projectId,
        query,
      ),
    };
  }

  @Get(':projectId/revisions/:revisionId')
  async getRevision(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.getRevision(
        user,
        workspaceId,
        params.projectId,
        params.revisionId,
      ),
    };
  }

  @Post(':projectId/revisions/lock')
  @HttpCode(HttpStatus.CREATED)
  async lockRevision(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(LockStoryRevisionSchema))
    body: LockStoryRevisionInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.lockRevision(
        user,
        workspaceId,
        params.projectId,
        body,
      ),
    };
  }

  @Get(':projectId')
  async get(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.get(user, workspaceId, params.projectId),
    };
  }

  @Patch(':projectId')
  async patch(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PatchStoryProjectSchema))
    body: PatchStoryProjectInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.patch(
        user,
        workspaceId,
        params.projectId,
        body,
      ),
    };
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(ArchiveStoryProjectSchema))
    body: ArchiveStoryProjectInput,
  ) {
    const workspaceId = requiredWorkspaceId(workspaceHeader);
    return {
      code: 200,
      data: await this.storyProjects.archive(
        user,
        workspaceId,
        params.projectId,
        body,
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  if (!normalized) {
    throw new BadRequestException({
      code: 'WORKSPACE_HEADER_REQUIRED',
      message: 'x-fizz-workspace-id is required.',
    });
  }
  const parsed = StoryUuidSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'WORKSPACE_HEADER_INVALID',
      message: 'x-fizz-workspace-id must be a valid UUID.',
    });
  }
  return parsed.data;
}
