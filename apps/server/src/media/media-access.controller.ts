import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  MediaAssetAccessParamsSchema,
  MediaAssetAccessQuerySchema,
  type MediaAssetAccessParamsDto,
  type MediaAssetAccessQueryDto,
  type MediaAssetAccessResponseDto,
} from './dto';
import { MediaAccessService } from './media-access.service';

@Controller('media/assets')
export class MediaAccessController {
  constructor(private readonly svc: MediaAccessService) {}

  @Public()
  @Get(':assetId/access')
  async issueAccessUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    return this.svc.issueBrowserAccessUrl(user?.userId, params.assetId, query);
  }

  @Public()
  @Get(':assetId/content')
  async redirectToContent(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
    @Res() response: Response,
  ) {
    const access = await this.svc.issueBrowserAccessUrl(
      user?.userId,
      params.assetId,
      query,
    );
    response.setHeader('cache-control', 'private, no-store');
    return response.redirect(302, access.url);
  }
}
