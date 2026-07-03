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
  PatchStoryProjectSchema,
  PutStoryDraftSchema,
  StoryProjectIdParamsSchema,
  type CreateStoryProjectInput,
  type PatchStoryProjectInput,
  type PutStoryDraftInput,
  type StoryProjectIdParams,
} from './dto';
import { StoryProjectsService } from './story-projects.service';

@Controller('story-projects')
export class StoryProjectsController {
  constructor(private readonly storyProjects: StoryProjectsService) {}

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
