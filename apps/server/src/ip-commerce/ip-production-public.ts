import { Controller, Get, Param } from '@nestjs/common';
import { z } from 'zod';
import { Public, CurrentUser, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { ZodValidationPipe } from '../common/zod.pipe';
import { IpCommerceService } from './ip-commerce.service';
import { readProductionStage } from './ip-production-stage';

@Controller('ip-commerce/ips/:ipId/production-stage')
export class IpProductionPublicController {
  constructor(
    private readonly db: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  @Public()
  @Get()
  async read(
    @Param(new ZodValidationPipe(z.object({ ipId: z.string().uuid() })))
    params: { ipId: string },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.ips.ensurePublicEngagementTarget(user, params.ipId, tx);
        const state = await readProductionStage(tx, params.ipId);
        return { stage: state.stage };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
