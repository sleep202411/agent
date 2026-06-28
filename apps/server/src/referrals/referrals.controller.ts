import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, ViewerCookie, type AuthUser } from '../auth';
import { ReferralsService } from './referrals.service';

/**
 * /aurora/referrals — the "邀请奖励" surface. All routes are authenticated +
 * per-user. The dashboard fetches the user's own invite code from Java
 * (forwarded cookie); reward claims grant to the CURRENT user only.
 */
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @ViewerCookie() cookie: string) {
    return {
      code: 200,
      data: await this.service.getDashboard(user.userId, cookie),
    };
  }

  /** Claim (领取) an accrued reward → grant it by type, mark it paid_out. */
  @Post('rewards/:id/claim')
  async claimReward(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return {
      code: 200,
      data: await this.service.claimReward(user.userId, id),
    };
  }
}
