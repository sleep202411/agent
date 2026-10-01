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
  providers: [DiscoveryAssistantService],
  controllers: [DiscoveryAssistantController, DiscoveryAssistantReadController],
})
export class DiscoveryAssistantModule {}
