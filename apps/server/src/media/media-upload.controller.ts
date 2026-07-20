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
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ConfirmUploadSchema,
  CreateUploadUrlSchema,
  MediaProviderAssetStatusRequestSchema,
  type ConfirmUploadInputDto,
  type ConfirmUploadResponseDto,
  type CreateUploadUrlInputDto,
  type CreateUploadUrlResponseDto,
  type MediaProviderAssetStatusRequestDto,
  type MediaProviderAssetStatusResponseDto,
} from './dto';
import { MediaUploadService } from './media-upload.service';

@Controller('media')
export class MediaUploadController {
  constructor(private readonly svc: MediaUploadService) {}

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

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmUpload(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader: string | undefined,
    @Body(new ZodValidationPipe(ConfirmUploadSchema))
    body: ConfirmUploadInputDto,
  ): Promise<ConfirmUploadResponseDto> {
    return this.svc.confirmUpload(user.userId, body, workspaceHeader);
  }

  @Post('provider-assets/status')
  @HttpCode(HttpStatus.OK)
  async providerAssetStatuses(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MediaProviderAssetStatusRequestSchema))
    body: MediaProviderAssetStatusRequestDto,
  ): Promise<MediaProviderAssetStatusResponseDto> {
    return this.svc.providerAssetStatuses(user.userId, body);
  }
}
