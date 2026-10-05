import { DeviceCityService, DeviceCityController } from './device-city';
import {
  CreatorGeocodingService,
  CreatorGeocodingController,
} from './creator-geocoding';
import {
  CreatorDiscoveryController,
  CreatorDiscoveryService,
} from './creator-discovery';
import { LegacyCreatorsModule } from '../legacy-creators/legacy-creators.module';
import {
  CreatorLocationsController,
  CreatorLocationsService,
} from './creator-locations';
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
  imports: [AuthModule, LegacyCreatorsModule],
  controllers: [
    DeviceCityController,
    CreatorServicesController,
    CreatorLocationsController,
    CreatorGeocodingController,
    CreatorDiscoveryController,
  ],
  providers: [
    DeviceCityService,
    CreatorServicesService,
    CreatorLocationsService,
    CreatorGeocodingService,
    CreatorDiscoveryService,
  ],
  exports: [CreatorServicesService, CreatorDiscoveryService],
})
export class CreatorServicesModule {}
