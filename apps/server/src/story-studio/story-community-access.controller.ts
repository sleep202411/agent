import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryCommunityAccessService } from './story-community-access.service';
const ParamsSchema = z.object({
  projectId: z.string().uuid(),
  buildId: z.string().uuid(),
});
const PurchaseSchema = z
  .object({
    key: z.string().min(1).max(512),
    expectedPrice: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

@Controller('story-projects/:projectId/builds/:buildId/community-access')
export class StoryCommunityAccessController {
  constructor(private readonly access: StoryCommunityAccessService) {}
  @Get()
  @Public()
  async quote(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(ParamsSchema))
    params: z.infer<typeof ParamsSchema>,
  ) {
    return {
      code: 200,
      data: await this.access.quote(user, params.projectId, params.buildId),
    };
  }
  @Post()
  @HttpCode(200)
  async purchase(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ParamsSchema))
    params: z.infer<typeof ParamsSchema>,
    @Body(new ZodValidationPipe(PurchaseSchema))
    body: z.infer<typeof PurchaseSchema>,
  ) {
    return {
      code: 200,
      data: await this.access.purchase(
        user,
        params.projectId,
        params.buildId,
        body,
      ),
    };
  }
}
