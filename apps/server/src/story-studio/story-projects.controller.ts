import {
  Body,
  Controller,
  Delete,
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
  ImportStoryPlotSchema,
  StoryProjectIdParamsSchema,
  StoryChapterParamsSchema,
  StoryCandidateAssetParamsSchema,
  StoryProjectListQuerySchema,
  StoryRevisionListQuerySchema,
  StoryRevisionParamsSchema,
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
  type ImportStoryPlotInput,
  type StoryProjectIdParams,
  type StoryChapterParams,
  type StoryCandidateAssetParams,
  type StoryProjectListQuery,
  type StoryRevisionListQuery,
  type StoryRevisionParams,
  type StoryWorkbenchQuery,
  type ReorderStoryChaptersInput,
} from './dto';
import { StoryProjectsService } from './story-projects.service';

// Installed mobile clients send workspace identity in the existing header.
// Normalize it at the HTTP boundary; service DTOs always require workspaceId.
const CreateStoryProjectRequestSchema = CreateStoryProjectSchema.extend({
  workspaceId: CreateStoryProjectSchema.shape.workspaceId.optional(),
});
const StoryProjectListRequestSchema = StoryProjectListQuerySchema.extend({
  workspaceId: StoryProjectListQuerySchema.shape.workspaceId.optional(),
});

@Controller('story-projects')
export class StoryProjectsController {
  constructor(private readonly storyProjects: StoryProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoryProjectRequestSchema))
    body: Omit<CreateStoryProjectInput, 'workspaceId'> & {
      workspaceId?: string;
    },
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.create(
        user,
        new ZodValidationPipe(CreateStoryProjectSchema).transform({
          ...body,
          workspaceId: body.workspaceId ?? workspaceHeader,
        }),
      ),
    };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(StoryProjectListRequestSchema))
    query: Omit<StoryProjectListQuery, 'workspaceId'> & {
      workspaceId?: string;
    },
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.list(
        user,
        new ZodValidationPipe(StoryProjectListQuerySchema).transform({
          ...query,
          workspaceId: query.workspaceId ?? workspaceHeader,
        }),
      ),
    };
  }

  @Post(':projectId/chapters')
  @HttpCode(HttpStatus.CREATED)
  async createChapter(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CreateStoryChapterSchema))
    body: CreateStoryChapterInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.createChapter(
        user,
        params.projectId,
        body,
      ),
    };
  }

  @Patch(':projectId/chapters/:chapterId')
  async patchChapter(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PatchStoryChapterSchema))
    body: PatchStoryChapterInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.patchChapter(
        user,
        params.projectId,
        params.chapterId,
        body,
      ),
    };
  }

  @Put(':projectId/chapters/order')
  async reorderChapters(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(ReorderStoryChaptersSchema))
    body: ReorderStoryChaptersInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.reorderChapters(
        user,
        params.projectId,
        body,
      ),
    };
  }

  @Post(':projectId/chapters/:chapterId/archive')
  async archiveChapter(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.archiveChapter(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Put(':projectId/chapters/:chapterId/draft')
  async putChapterDraft(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PutStoryDraftSchema))
    body: PutStoryDraftInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.putDraft(
        user,
        params.projectId,
        body,
        params.chapterId,
      ),
    };
  }

  @Post(':projectId/chapters/:chapterId/plot-import')
  async importChapterPlot(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(ImportStoryPlotSchema))
    body: ImportStoryPlotInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.importPlot(
        user,
        params.projectId,
        body,
        params.chapterId,
      ),
    };
  }

  @Get(':projectId/chapters/:chapterId/canvas-layout')
  async getChapterCanvasLayout(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.getCanvasLayout(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Put(':projectId/chapters/:chapterId/canvas-layout')
  async putChapterCanvasLayout(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterParamsSchema))
    params: StoryChapterParams,
    @Body(new ZodValidationPipe(PutStoryCanvasLayoutSchema))
    body: PutStoryCanvasLayoutInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.putCanvasLayout(
        user,
        params.projectId,
        body,
        params.chapterId,
      ),
    };
  }

  @Get(':projectId/candidate-assets')
  async listCandidateAssets(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.listCandidateAssets(
        user,
        params.projectId,
      ),
    };
  }

  @Put(':projectId/candidate-assets/:mediaAssetId')
  async addCandidateAsset(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryCandidateAssetParamsSchema))
    params: StoryCandidateAssetParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.addCandidateAsset(
        user,
        params.projectId,
        params.mediaAssetId,
      ),
    };
  }

  @Delete(':projectId/candidate-assets/:mediaAssetId')
  async removeCandidateAsset(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryCandidateAssetParamsSchema))
    params: StoryCandidateAssetParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.removeCandidateAsset(
        user,
        params.projectId,
        params.mediaAssetId,
      ),
    };
  }

  @Get(':projectId/workbench')
  async workbench(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryWorkbenchQuerySchema))
    query: StoryWorkbenchQuery,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.workbench(user, params.projectId, query),
    };
  }

  @Get(':projectId/plot-tree')
  async getPlotTree(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.getPlotTree(user, params.projectId),
    };
  }

  @Get(':projectId/revisions')
  async listRevisions(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryRevisionListQuerySchema))
    query: StoryRevisionListQuery,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.listRevisions(
        user,
        params.projectId,
        query,
      ),
    };
  }

  @Get(':projectId/revisions/:revisionId')
  async getRevision(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.getRevision(
        user,
        params.projectId,
        params.revisionId,
      ),
    };
  }

  @Post(':projectId/revisions/lock')
  @HttpCode(HttpStatus.CREATED)
  async lockRevision(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(LockStoryRevisionSchema))
    body: LockStoryRevisionInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.lockRevision(user, params.projectId, body),
    };
  }

  @Get(':projectId')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.get(user, params.projectId),
    };
  }

  @Patch(':projectId')
  async patch(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PatchStoryProjectSchema))
    body: PatchStoryProjectInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.patch(user, params.projectId, body),
    };
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(ArchiveStoryProjectSchema))
    body: ArchiveStoryProjectInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.archive(user, params.projectId, body),
    };
  }
}
