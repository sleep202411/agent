import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements';
import { LegacyMysqlModule } from '../infra/legacy-mysql';
import { WorkspacesModule } from '../workspaces';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

// PrismaService comes from the global DbModule; no local imports needed.
// ReferralsService is exported so later phases (billing qualify hook,
// settlement job) can reuse it without re-implementing the rules.
@Module({
  imports: [LegacyMysqlModule, EntitlementsModule, WorkspacesModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
