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
import type { StoryBuildAssetPlaybackResponse } from '@repo/shared/story-playback';
import { streamStoryPrivateMedia } from './story-private-media';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CancelStoryBuildSchema,
  CreateStoryBuildSchema,
  PrepareStoryExperienceReleaseSchema,
  StoryBuildAssetParamsSchema,
  StoryBuildListQuerySchema,
  StoryBuildParamsSchema,
  StoryProjectIdParamsSchema,
  type CancelStoryBuildInput,
  type CreateStoryBuildInput,
  type PrepareStoryExperienceReleaseInput,
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
        params.projectId,
        body,
        requiredIdempotencyKey(idempotencyHeader),
      ),
    };
  }

  @Get(':projectId/builds')
  async listBuilds(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Query(new ZodValidationPipe(StoryBuildListQuerySchema))
    query: StoryBuildListQuery,
  ) {
    return {
      code: 200,
      data: await this.builds.listBuilds(user, params.projectId, query),
    };
  }

  @Get(':projectId/builds/:buildId')
  async getBuild(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryBuildParamsSchema))
    params: StoryBuildParams,
  ) {
    return {
      code: 200,
      data: await this.builds.getBuild(user, params.projectId, params.buildId),
    };
  }

  @Get(':projectId/builds/:buildId/assets/:assetId/variants/:variantId/content')
  @Public()
  async redirectToBuildAsset(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(StoryBuildAssetParamsSchema))
    params: StoryBuildAssetParams,
    @Res() response: Response,
    @Headers('range') range?: string,
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
    if (access.stream)
      return streamStoryPrivateMedia(access.url, response, range);
    return response.redirect(HttpStatus.FOUND, access.url);
  }

  /**
   * HLS-capable players ask here before choosing a provider for a frozen clip.
   * `/content` never changes shape, so clients that only play progressive
   * files keep working; `data: null` means keep playing `/content`. Same
   * public/optional-viewer contract and error codes as `/content`.
   */
  @Get(
    ':projectId/builds/:buildId/assets/:assetId/variants/:variantId/playback',
  )
  @Public()
  async buildAssetPlayback(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(StoryBuildAssetParamsSchema))
    params: StoryBuildAssetParams,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.builds.resolveBuildAssetPlayback(
      user,
      params.projectId,
      params.buildId,
      params.assetId,
      params.variantId,
    );
    response.setHeader('cache-control', 'private, no-store');
    return { code: 200, data } satisfies StoryBuildAssetPlaybackResponse;
  }

  @Get(':projectId/builds/:buildId/assets/:assetId/variants/:variantId/poster')
  @Public()
  async buildAssetPoster(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(StoryBuildAssetParamsSchema))
    params: StoryBuildAssetParams,
    @Res() response: Response,
  ) {
    const frame = await this.builds.readBuildAssetPoster(
      user,
      params.projectId,
      params.buildId,
      params.assetId,
      params.variantId,
    );
    response.setHeader('cache-control', 'private, no-store');
    response.type('image/jpeg');
    return response.send(frame);
  }

  @Post(':projectId/builds/:buildId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBuild(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryBuildParamsSchema))
    params: StoryBuildParams,
    @Body(new ZodValidationPipe(CancelStoryBuildSchema))
    body: CancelStoryBuildInput,
  ) {
    return {
      code: 200,
      data: await this.builds.cancelBuild(
        user,
        params.projectId,
        params.buildId,
        body,
      ),
    };
  }

  @Post(':projectId/release-candidate')
  @HttpCode(HttpStatus.OK)
  async prepareReleaseCandidate(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(PrepareStoryExperienceReleaseSchema))
    body: PrepareStoryExperienceReleaseInput,
  ) {
    return {
      code: 200,
      data: await this.releases.prepareProjectCandidate(
        user,
        params.projectId,
        body,
      ),
    };
  }
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
