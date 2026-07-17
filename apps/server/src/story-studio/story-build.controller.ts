import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public, ViewerCookie, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CancelStoryBuildSchema,
  CreateStoryBuildSchema,
  PublishStoryBuildSchema,
  StoryBuildAssetParamsSchema,
  StoryBuildListQuerySchema,
  StoryBuildParamsSchema,
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type CancelStoryBuildInput,
  type CreateStoryBuildInput,
  type PublishStoryBuildInput,
  type StoryBuildAssetParams,
  type StoryBuildListQuery,
  type StoryBuildParams,
  type StoryProjectIdParams,
} from './dto';
import { StoryBuildService } from './story-build.service';
import { StoryExperienceReleaseService } from './story-experience-release.service';

@Controller('story-projects')
export class StoryBuildController {
  constructor(
    private readonly builds: StoryBuildService,
    private readonly releases: StoryExperienceReleaseService,
  ) {}

  @Post(':projectId/builds')
  @HttpCode(HttpStatus.CREATED)
  async createBuild(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Headers('idempotency-key')
    idempotencyHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CreateStoryBuildSchema))
    body: CreateStoryBuildInput,
  ) {
    return {
      code: 200,
      data: await this.builds.createBuild(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/builds')
  async listBuilds(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryBuildListQuerySchema))
    query: StoryBuildListQuery,
  ) {
    return {
      code: 200,
      data: await this.builds.listBuilds(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        query,
      ),
    };
  }

  @Get(':projectId/builds/:buildId')
  async getBuild(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryBuildParamsSchema))
    params: StoryBuildParams,
  ) {
    return {
      code: 200,
      data: await this.builds.getBuild(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.buildId,
      ),
    };
  }

  @Get(':projectId/builds/:buildId/assets/:assetId/variants/:variantId/content')
  @Public()
  async redirectToBuildAsset(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(StoryBuildAssetParamsSchema))
    params: StoryBuildAssetParams,
    @Res() response: Response,
  ) {
    // @Public keeps Java/CDN's immutable Manifest URI usable anonymously after
    // publication. AuthGuard still attaches a valid optional viewer, allowing
    // the service to enforce live story.read access for every private Build.
    const access = await this.builds.issueBuildAssetReadUrl(
      user,
      params.projectId,
      params.buildId,
      params.assetId,
      params.variantId,
    );
    response.setHeader('cache-control', 'private, no-store');
    return response.redirect(HttpStatus.FOUND, access.url);
  }

  @Post(':projectId/builds/:buildId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBuild(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryBuildParamsSchema))
    params: StoryBuildParams,
    @Body(new ZodValidationPipe(CancelStoryBuildSchema))
    body: CancelStoryBuildInput,
  ) {
    return {
      code: 200,
      data: await this.builds.cancelBuild(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.buildId,
        body,
      ),
    };
  }

  @Get(':projectId/releases/current')
  async getCurrentRelease(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.releases.getCurrentRelease(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Post(':projectId/builds/:buildId/publish')
  @HttpCode(HttpStatus.OK)
  async publishBuild(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @ViewerCookie() viewerCookie: string,
    @Param(new ZodValidationPipe(StoryBuildParamsSchema))
    params: StoryBuildParams,
    @Body(new ZodValidationPipe(PublishStoryBuildSchema))
    body: PublishStoryBuildInput,
  ) {
    return {
      code: 200,
      data: await this.releases.publishBuild(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        params.buildId,
        body,
        viewerCookie,
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  const parsed = StoryUuidSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: normalized
        ? 'WORKSPACE_HEADER_INVALID'
        : 'WORKSPACE_HEADER_REQUIRED',
      message: normalized
        ? 'x-fizz-workspace-id must be a valid UUID.'
        : 'x-fizz-workspace-id is required.',
    });
  }
  return parsed.data;
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException({
      code: normalized ? 'IDEMPOTENCY_KEY_INVALID' : 'IDEMPOTENCY_KEY_REQUIRED',
      message: normalized
        ? 'Idempotency-Key must be at most 160 characters.'
        : 'Idempotency-Key is required for Build creation.',
    });
  }
  return normalized;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
