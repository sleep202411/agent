import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreatorEarningsService,
  EarningsQuerySchema,
  type EarningsQuery,
} from './creator-earnings.service';

@Controller('creator-earnings')
export class CreatorEarningsController {
  constructor(private readonly earnings: CreatorEarningsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(EarningsQuerySchema)) query: EarningsQuery,
  ) {
    return { code: 200, data: await this.earnings.list(user.userId, query) };
  }
}
