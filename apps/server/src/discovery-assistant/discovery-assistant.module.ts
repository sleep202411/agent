import { DiscoveryPreferencesService } from '../discovery-preferences/discovery-preferences.service';
import { DiscoveryPreferencesController } from '../discovery-preferences/discovery-preferences.controller';
import { Module } from '@nestjs/common';
import { IpCommerceModule } from '../ip-commerce/ip-commerce.module';
import { CreatorServicesModule } from '../creator-services/creator-services.module';
import { DiscoveryAssistantService } from './discovery-assistant.service';
import {
  DiscoveryAssistantController,
  DiscoveryAssistantReadController,
} from './discovery-assistant.controller';
@Module({
  imports: [IpCommerceModule, CreatorServicesModule],
  providers: [DiscoveryAssistantService, DiscoveryPreferencesService],
  controllers: [
    DiscoveryAssistantController,
    DiscoveryAssistantReadController,
    DiscoveryPreferencesController,
  ],
})
export class DiscoveryAssistantModule {}
