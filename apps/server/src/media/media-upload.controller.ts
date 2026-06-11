/**
 * /aurora/media/*  — direct-to-storage upload pipeline (stateless + confirm).
 *
 *   POST /aurora/media/upload-url   STATELESS. Mint a signed write URL for
 *                                   a server-decided, caller-scoped key. NO
 *                                   MediaAsset is created here.
 *   POST /aurora/media/confirm      After the PUT lands: verify ownership +
 *                                   blob existence (HEAD), then create the
 *                                   ACTIVE MediaAsset. Idempotent.
 *
 * Authenticated only — the global AuthGuard runs before this controller,
 * so @CurrentUser() is always populated; the userId is the scope root for
 * the storage key (issue) and the ownership check (confirm). There is NO
 * @Public() route here.
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ConfirmUploadSchema,
  CreateUploadUrlSchema,
  type ConfirmUploadInputDto,
  type ConfirmUploadResponseDto,
  type CreateUploadUrlInputDto,
  type CreateUploadUrlResponseDto,
} from './dto';
import { MediaUploadService } from './media-upload.service';

@Controller('media')
export class MediaUploadController {
  constructor(private readonly svc: MediaUploadService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  async createUploadUrl(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateUploadUrlSchema))
    body: CreateUploadUrlInputDto,
  ): Promise<CreateUploadUrlResponseDto> {
    return this.svc.createUploadUrl(user.userId, body);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ConfirmUploadSchema))
    body: ConfirmUploadInputDto,
  ): Promise<ConfirmUploadResponseDto> {
    return this.svc.confirmUpload(user.userId, body);
  }
}
