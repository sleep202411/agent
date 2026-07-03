/**
 * Story Studio project routes (owner-only). Same envelope + validation
 * conventions as the characters module: `{ code: 200, data }`, Zod pipes,
 * the global user AuthGuard supplies `@CurrentUser()`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateStoryProjectSchema,
  GenerateStoryAnalysisSchema,
  PatchStoryProjectSchema,
  PutStoryDraftSchema,
  StoryProjectIdParamsSchema,
  type CreateStoryProjectInput,
  type GenerateStoryAnalysisInput,
  type PatchStoryProjectInput,
  type PutStoryDraftInput,
  type StoryProjectIdParams,
} from './dto';
import { StoryGenerationService } from './generation/story-generation.service';
import { StoryProjectsService } from './story-projects.service';

@Controller('story-projects')
export class StoryProjectsController {
  constructor(
    private readonly storyProjects: StoryProjectsService,
    private readonly generation: StoryGenerationService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoryProjectSchema))
    body: CreateStoryProjectInput,
  ) {
    return { code: 200, data: await this.storyProjects.create(user, body) };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.storyProjects.list(user) };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return { code: 200, data: await this.storyProjects.get(user, params.id) };
  }

  @Patch(':id')
  async patch(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PatchStoryProjectSchema))
    body: PatchStoryProjectInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.patch(user, params.id, body),
    };
  }

  /** S1 StoryOS analysis (ASYNC): marks the draft's pipeline `running` and
   *  returns immediately — the model run completes in the background and
   *  persists into the draft; the client polls the draft until done/error.
   *  Proxy-timeout-proof by design (model calls run 30-90s). */
  @Post(':id/generate/analysis')
  async generateAnalysis(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(GenerateStoryAnalysisSchema))
    body: GenerateStoryAnalysisInput,
  ) {
    return {
      code: 200,
      data: await this.generation.startAnalysis(user, params.id, body),
    };
  }

  @Put(':id/draft')
  async putDraft(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PutStoryDraftSchema))
    body: PutStoryDraftInput,
  ) {
    return {
      code: 200,
      data: await this.storyProjects.putDraft(user, params.id, body),
    };
  }

  @Delete(':id')
  async archive(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    await this.storyProjects.archive(user, params.id);
    return { code: 200, data: { archived: true } };
  }
}
