/**
 * /aurora/media/* — authenticated direct-to-storage upload pipeline.
 *
 *   POST /aurora/media/upload-url   Mint a signed write URL for a
 *                                   server-decided, caller-scoped key. Story
 *                                   clips first persist a durable staging
 *                                   session; generic kinds remain stateless.
 *   POST /aurora/media/confirm      After the PUT lands: verify ownership +
 *                                   blob existence (HEAD), then create the
 *                                   MediaAsset. Story assets remain uploading
 *                                   until asynchronous finalization. Idempotent.
 *
 * Authenticated only — the global AuthGuard runs before this controller,
 * so @CurrentUser() is always populated; the userId is the scope root for
 * the storage key (issue) and the ownership check (confirm). There is NO
 * @Public() route here.
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ConfirmUploadSchema,
  CreateUploadUrlSchema,
  MediaAssetAccessParamsSchema,
  MediaAssetReadinessCheckRequestSchema,
  MediaAssetReadinessStatusRequestSchema,
  type ConfirmUploadInputDto,
  type ConfirmUploadResponseDto,
  type CreateUploadUrlInputDto,
  type CreateUploadUrlResponseDto,
  type MediaAssetAccessParamsDto,
  type MediaAssetReadinessCheckRequestDto,
  type MediaAssetReadinessCheckResponseDto,
  type MediaAssetReadinessStatusRequestDto,
  type MediaAssetReadinessStatusResponseDto,
} from './dto';
import { MediaAssetReadinessService } from './media-asset-readiness.service';
import { MediaUploadService } from './media-upload.service';

@Controller('media')
export class MediaUploadController {
  private readonly logger = new Logger(MediaUploadController.name);

  constructor(
    private readonly svc: MediaUploadService,
    private readonly readiness: MediaAssetReadinessService,
  ) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  async createUploadUrl(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader: string | undefined,
    @Body(new ZodValidationPipe(CreateUploadUrlSchema))
    body: CreateUploadUrlInputDto,
  ): Promise<CreateUploadUrlResponseDto> {
    return this.svc.createUploadUrl(user.userId, body, workspaceHeader);
  }

  @Post('cancel-upload')
  @HttpCode(HttpStatus.OK)
  cancelUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ConfirmUploadSchema))
    body: ConfirmUploadInputDto,
  ) {
    return this.svc.cancelUpload(user.userId, body);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmUpload(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader: string | undefined,
    @Body(new ZodValidationPipe(ConfirmUploadSchema))
    body: ConfirmUploadInputDto,
  ): Promise<ConfirmUploadResponseDto> {
    try {
      return await this.svc.confirmUpload(user.userId, body, workspaceHeader);
    } catch (error) {
      if (body.kind === 'crew_asset_file') {
        try {
          await this.svc.cancelUpload(user.userId, body);
        } catch {
          // Reservation expiry recovers failed cleanup. Keep the original
          // confirmation status/code so clients can handle it correctly.
          this.logger.warn(
            'Crew upload reservation cleanup failed after confirmation failure',
          );
        }
      }
      throw error;
    }
  }

  @Post('asset-readiness/status')
  @HttpCode(HttpStatus.OK)
  async assetReadinessStatuses(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MediaAssetReadinessStatusRequestSchema))
    body: MediaAssetReadinessStatusRequestDto,
  ): Promise<MediaAssetReadinessStatusResponseDto> {
    const assets = await this.readiness.listStatusesForUser(
      user.userId,
      body.capability,
      body.assetIds,
      { documentId: body.documentId },
    );
    return { assets };
  }

  @Post('assets/:assetId/readiness-checks')
  @HttpCode(HttpStatus.OK)
  async requestAssetReadinessCheck(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(MediaAssetAccessParamsSchema))
    params: MediaAssetAccessParamsDto,
    @Body(new ZodValidationPipe(MediaAssetReadinessCheckRequestSchema))
    body: MediaAssetReadinessCheckRequestDto,
  ): Promise<MediaAssetReadinessCheckResponseDto> {
    const asset = await this.readiness.requestCheckForUser(
      user.userId,
      params.assetId,
      body.capability,
      { documentId: body.documentId },
    );
    return { asset };
  }
}
