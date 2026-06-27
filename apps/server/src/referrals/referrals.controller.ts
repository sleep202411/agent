import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ClaimReferralSchema, type ClaimReferralInput } from './dto';
import { ReferralsService } from './referrals.service';

/**
 * /aurora/referrals — the "邀请奖励" surface. Both routes are authenticated:
 * the dashboard is per-user, and claim attributes the CURRENT user as the
 * referee (so it can't be spoofed for someone else).
 */
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.service.getDashboard(user.userId) };
  }

  @Post('claim')
  async claim(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ClaimReferralSchema)) body: ClaimReferralInput,
  ) {
    return {
      code: 200,
      data: await this.service.claim(user.userId, body.code),
    };
  }
}
