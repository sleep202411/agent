import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from '@repo/shared';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ContentReviewBillingService } from './content-review-billing.service';

const HoldSchema = z.object({
  id: z.string().uuid().optional(),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(CONTENT_REVIEW_MAX_DURATION_SECONDS),
});
const IdSchema = z.string().uuid();

@Controller('content-review/charges')
export class ContentReviewBillingController {
  constructor(private readonly billing: ContentReviewBillingService) {}

  @Post()
  @HttpCode(200)
  async hold(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Body(new ZodValidationPipe(HoldSchema))
    input: { id?: string; durationSeconds: number },
  ) {
    return {
      code: 200 as const,
      data: await this.billing.hold(
        user.userId,
        workspace,
        input.durationSeconds,
        input.id,
      ),
    };
  }

  @Post(':id/settle')
  @HttpCode(200)
  async settle(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return {
      code: 200 as const,
      data: await this.billing.settle(user.userId, workspace, id),
    };
  }

  @Post(':id/release')
  @HttpCode(200)
  async release(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | undefined,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    return {
      code: 200 as const,
      data: await this.billing.release(user.userId, workspace, id),
    };
  }
}
