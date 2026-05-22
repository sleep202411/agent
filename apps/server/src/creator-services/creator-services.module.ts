import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { CreatorServicesController } from './creator-services.controller';
import { CreatorServicesService } from './creator-services.service';

/**
 * Creator-services — marketplace layer over the talent pool. Owners
 * publish service packages here; visitors browse + (Phase 1b) order.
 *
 * Server-owned, no Java dependency for any of these endpoints; Java
 * only contributes user identity (resolved by AuthGuard before any
 * controller method runs).
 */
@Module({
  imports: [AuthModule],
  controllers: [CreatorServicesController],
  providers: [CreatorServicesService],
  exports: [CreatorServicesService],
})
export class CreatorServicesModule {}
