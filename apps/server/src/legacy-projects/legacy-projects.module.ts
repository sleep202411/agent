import { Module } from '@nestjs/common';
import { LegacyProjectsController } from './legacy-projects.controller';
import { LegacyProjectsService } from './legacy-projects.service';

@Module({
  controllers: [LegacyProjectsController],
  providers: [LegacyProjectsService],
})
export class LegacyProjectsModule {}
