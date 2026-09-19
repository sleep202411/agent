import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
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
  type MediaVideoPosterResponseDto,
} from './dto';
import { MediaAccessService } from './media-access.service';

@Controller('media/assets')
export class MediaAccessController {
  constructor(private readonly svc: MediaAccessService) {}

  /** JSON read endpoints answer with the `{ code, data }` envelope every
   *  aurora api client parses — a bare body reads as "request failed". The
   *  302 `/content` route is consumed by URL, never parsed, so it stays a
   *  plain redirect. */
  @Public()
  @Get(':assetId/poster')
  @Header('Cache-Control', 'private, no-store')
  async videoPoster(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
  ): Promise<{ code: 200; data: MediaVideoPosterResponseDto }> {
    return {
      code: 200,
      data: await this.svc.issueVideoPosterUrl(
        user?.userId,
        params.assetId,
        query,
      ),
    };
  }

  @Public()
  @Get(':assetId/access')
  async issueAccessUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Query(new ZodValidationPipe(MediaAssetAccessQuerySchema))
    query: MediaAssetAccessQueryDto,
  ): Promise<{ code: 200; data: MediaAssetAccessResponseDto }> {
    return {
      code: 200,
      data: await this.svc.issueBrowserAccessUrl(
        user?.userId,
        params.assetId,
        query,
      ),
    };
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
