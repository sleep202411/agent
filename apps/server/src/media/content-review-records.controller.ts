import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from '@repo/shared';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ContentReviewRecordsService } from './content-review-records.service';

const JsonObject = z.record(z.string(), z.unknown());
const CreateSchema = z.object({
  mediaAssetId: z.string().uuid(),
  chargeId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(256),
  exportFileName: z.string().trim().min(1).max(256),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(CONTENT_REVIEW_MAX_DURATION_SECONDS),
  creditsCharged: z.number().int().min(1),
  overview: JsonObject,
  details: z.array(JsonObject).max(2000),
});
const IdSchema = z.string().uuid();
const CommentSchema = z.object({
  seconds: z.number().min(0).max(CONTENT_REVIEW_MAX_DURATION_SECONDS),
  body: z.string().trim().min(1).max(2000),
});

@Controller('content-review/records')
export class ContentReviewRecordsController {
  constructor(private readonly records: ContentReviewRecordsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
  ) {
    return {
      code: 200 as const,
      data: await this.records.list(user.userId, workspace),
    };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return {
      code: 200 as const,
      data: await this.records.get(user.userId, workspace, id),
    };
  }

  @Post(':id/comments')
  @HttpCode(200)
  async addComment(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CommentSchema))
    input: z.infer<typeof CommentSchema>,
  ) {
    return {
      code: 200 as const,
      data: await this.records.addComment(user.userId, workspace, id, input),
    };
  }

  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Body(new ZodValidationPipe(CreateSchema))
    input: z.infer<typeof CreateSchema>,
  ) {
    return {
      code: 200 as const,
      data: await this.records.create(user.userId, workspace, {
        mediaAssetId: input.mediaAssetId,
        chargeId: input.chargeId,
        fileName: input.fileName,
        exportFileName: input.exportFileName,
        durationSeconds: input.durationSeconds,
        creditsCharged: input.creditsCharged,
        overview: input.overview,
        details: input.details,
      }),
    };
  }
}
