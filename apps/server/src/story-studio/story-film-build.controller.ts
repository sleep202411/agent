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
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CancelFilmBuildSchema,
  CreateFilmBuildSchema,
  FilmBuildListQuerySchema,
  StoryFilmBuildAssetParamsSchema,
  StoryFilmBuildParamsSchema,
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type CancelFilmBuildInput,
  type CreateFilmBuildInput,
  type FilmBuildListQuery,
  type StoryFilmBuildAssetParams,
  type StoryFilmBuildParams,
  type StoryProjectIdParams,
} from './dto';
import { StoryFilmBuildService } from './story-film-build.service';

@Controller('story-projects')
export class StoryFilmBuildController {
  constructor(private readonly builds: StoryFilmBuildService) {}

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
    @Body(new ZodValidationPipe(CreateFilmBuildSchema))
    body: CreateFilmBuildInput,
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
    @Query(new ZodValidationPipe(FilmBuildListQuerySchema))
    query: FilmBuildListQuery,
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
    @Param(new ZodValidationPipe(StoryFilmBuildParamsSchema))
    params: StoryFilmBuildParams,
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
  async redirectToBuildAsset(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryFilmBuildAssetParamsSchema))
    params: StoryFilmBuildAssetParams,
    @Res() response: Response,
  ) {
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
    @Param(new ZodValidationPipe(StoryFilmBuildParamsSchema))
    params: StoryFilmBuildParams,
    @Body(new ZodValidationPipe(CancelFilmBuildSchema))
    body: CancelFilmBuildInput,
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
