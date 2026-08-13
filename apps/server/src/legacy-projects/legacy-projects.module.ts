import { Module } from '@nestjs/common';
import { LegacyProjectsController } from './legacy-projects.controller';
import { LegacyProjectsService } from './legacy-projects.service';
import { LegacyProjectsConfigService } from './legacy-projects.config';

@Module({
  controllers: [LegacyProjectsController],
  providers: [LegacyProjectsConfigService, LegacyProjectsService],
})
export class LegacyProjectsModule {}
