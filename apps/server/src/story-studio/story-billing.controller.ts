import { Controller, Get, Param } from '@nestjs/common';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryProjectIdParamsSchema, type StoryProjectIdParams } from './dto';

@Controller('story-projects/:projectId/billing')
export class StoryBillingController {
  constructor(private readonly aiGeneration: AiGenerationService) {}

  @Get('balance')
  async balance(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.aiGeneration.getStoryBillingBalance(
        user,
        params.projectId,
      ),
    };
  }
}
