/**
 * LegacyPointsModule — admin grant/deduct of the Java legacy points
 * balance over the LegacyMysql bridge.
 *
 * Imports LegacyMysqlModule explicitly (the bridge is non-global by
 * design) and AdminAuthModule for the guards + audit service.
 */
import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { LegacyMysqlModule } from '../infra/legacy-mysql';
import { LegacyPointsAdminController } from './legacy-points-admin.controller';
import { LegacyPointsService } from './legacy-points.service';

@Module({
  imports: [LegacyMysqlModule, AdminAuthModule],
  controllers: [LegacyPointsAdminController],
  providers: [LegacyPointsService],
  exports: [LegacyPointsService],
})
export class LegacyPointsModule {}
