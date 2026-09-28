import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { StoryboardChildrenService } from './storyboard-children.service';
import {
  StoryboardTaskCandidatesSchema,
  type StoryboardTaskCandidatesQuery,
  CreateStoryboardChildSchema,
  type CreateStoryboardChildInput,
  LinkStoryboardChildSchema,
  type LinkStoryboardChildInput,
} from './storyboard-children.dto';

@Controller('projects/:projectId/storyboard/children')
export class ProjectStoryboardChildrenController {
  constructor(private readonly service: StoryboardChildrenService) {}

  @Get()
  async list(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.service.list(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
      ),
    };
  }

  @Get('candidates')
  async candidates(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(StoryboardTaskCandidatesSchema))
    query: StoryboardTaskCandidatesQuery,
  ) {
    return {
      code: 200,
      data: await this.service.candidates(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
        query,
      ),
    };
  }

  @Post(':nodeId/link')
  async link(
    @Param('projectId') projectIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LinkStoryboardChildSchema))
    body: LinkStoryboardChildInput,
  ) {
    return {
      code: 200,
      data: await this.service.link(
        parseIdParam(projectIdRaw, 'projectId'),
        nodeId,
        user.userId,
        body,
      ),
    };
  }

  @Post(':nodeId/create')
  async create(
    @Param('projectId') projectIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoryboardChildSchema))
    body: CreateStoryboardChildInput,
  ) {
    return {
      code: 200,
      data: await this.service.create(
        parseIdParam(projectIdRaw, 'projectId'),
        nodeId,
        user.userId,
        body,
      ),
    };
  }
}

@Controller('story-projects/:projectId/storyboard/children')
export class StoryStoryboardChildrenController {
  constructor(private readonly service: StoryboardChildrenService) {}

  @Get()
  async list(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.service.list(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
      ),
    };
  }

  @Get('candidates')
  async candidates(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(StoryboardTaskCandidatesSchema))
    query: StoryboardTaskCandidatesQuery,
  ) {
    return {
      code: 200,
      data: await this.service.candidates(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
        query,
      ),
    };
  }

  @Post(':nodeId/link')
  async link(
    @Param('projectId') projectIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LinkStoryboardChildSchema))
    body: LinkStoryboardChildInput,
  ) {
    return {
      code: 200,
      data: await this.service.link(
        parseIdParam(projectIdRaw, 'projectId'),
        nodeId,
        user.userId,
        body,
      ),
    };
  }

  @Post(':nodeId/create')
  async create(
    @Param('projectId') projectIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoryboardChildSchema))
    body: CreateStoryboardChildInput,
  ) {
    return {
      code: 200,
      data: await this.service.create(
        parseIdParam(projectIdRaw, 'projectId'),
        nodeId,
        user.userId,
        body,
      ),
    };
  }
}
