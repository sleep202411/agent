import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

// PrismaService comes from the global DbModule; no local imports needed.
// ReferralsService is exported so later phases (billing qualify hook,
// settlement job) can reuse it without re-implementing the rules.
@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
