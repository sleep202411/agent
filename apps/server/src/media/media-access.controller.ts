import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth';
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

  @Get(':assetId/access')
  async issueAccessUrl(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    return this.svc.issueAccessUrl(user.userId, params.assetId, query);
  }

  @Get(':assetId/content')
  async redirectToContent(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
    @Res() response: Response,
  ) {
    const access = await this.svc.issueAccessUrl(
      user.userId,
      params.assetId,
      query,
    );
    response.setHeader('cache-control', 'private, no-store');
    return response.redirect(302, access.url);
  }
}
