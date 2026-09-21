import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CONTENT_REVIEW_VIDEO_MAX_BYTES,
  EPISODE_SOURCE_MAX_BYTES,
} from '@repo/shared';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  EpisodeUploadService,
  type StartEpisodeUpload,
} from './episode-upload.service';

const MultipartUploadKindSchema = z.enum([
  'episode_source_video',
  'content_review_video',
]);

const StartSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().trim().min(1).max(256),
    contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
    sizeBytes: z.number().int().positive().max(EPISODE_SOURCE_MAX_BYTES),
    kind: MultipartUploadKindSchema.default('episode_source_video'),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== 'content_review_video') return;
    if (value.contentType === 'video/webm') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentType'],
        message: 'Content review videos must be MP4 or MOV',
      });
    }
    if (value.sizeBytes > CONTENT_REVIEW_VIDEO_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message: 'Content review videos must be 2 GB or smaller',
      });
    }
  });
const IdSchema = z.string().uuid();

@Controller('media/episode-uploads')
export class EpisodeUploadController {
  constructor(private readonly uploads: EpisodeUploadService) {}

  @Post()
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Body(new ZodValidationPipe(StartSchema)) input: StartEpisodeUpload,
  ) {
    return this.uploads.start(user.userId, input, workspace);
  }

  @Get(':id')
  status(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return this.uploads.status(user.userId, id, workspace);
  }

  @Post(':id/parts/:number')
  @HttpCode(200)
  part(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Param('number', new ZodValidationPipe(z.coerce.number().int().positive()))
    number: number,
  ) {
    return this.uploads.signPart(user.userId, id, number, workspace);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return this.uploads.complete(user.userId, id, workspace);
  }

  @Delete(':id')
  @HttpCode(204)
  cancel(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return this.uploads.cancel(user.userId, id, workspace);
  }
}
