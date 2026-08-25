import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ServiceTokenGuard } from './service-token.guard';
import { InternalPointsService } from './internal-points.service';
import {
  CommunityGrantSchema,
  DeductPointsSchema,
  GrantPointsSchema,
  MigratePointsSchema,
  PointsBalanceQuerySchema,
  type CommunityGrantInput,
  type DeductPointsInput,
  type GrantPointsInput,
  type MigratePointsInput,
  type PointsBalanceQuery,
} from './internal-points.dto';

/**
 * Machine-facing points bridge for the Java backend (lazy per-user migration).
 * @Public() skips user (satoken) auth; ServiceTokenGuard enforces the shared
 * service secret instead.
 */
@Public()
@UseGuards(ServiceTokenGuard)
@Controller('internal/points')
export class InternalPointsController {
  constructor(private readonly points: InternalPointsService) {}

  @Post('migrate')
  async migrate(
    @Body(new ZodValidationPipe(MigratePointsSchema)) body: MigratePointsInput,
  ) {
    return { code: 200, data: await this.points.migrate(body) };
  }

  @Post('deduct')
  async deduct(
    @Body(new ZodValidationPipe(DeductPointsSchema)) body: DeductPointsInput,
  ) {
    return { code: 200, data: await this.points.deduct(body) };
  }

  @Post('grant')
  async grant(
    @Body(new ZodValidationPipe(GrantPointsSchema)) body: GrantPointsInput,
  ) {
    return { code: 200, data: await this.points.grant(body) };
  }

  @Post('community/grant')
  async grantCommunity(
    @Body(new ZodValidationPipe(CommunityGrantSchema))
    body: CommunityGrantInput,
  ) {
    return { code: 200, data: await this.points.grantCommunity(body) };
  }

  @Get('balance')
  async balance(
    @Query(new ZodValidationPipe(PointsBalanceQuerySchema))
    query: PointsBalanceQuery,
  ) {
    return { code: 200, data: await this.points.getBalance(query.userId) };
  }
}
