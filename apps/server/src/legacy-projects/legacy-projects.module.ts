import { Module } from '@nestjs/common';
import { LegacyMysqlModule } from '../infra/legacy-mysql';
import { LegacyProjectsController } from './legacy-projects.controller';
import { LegacyProjectsService } from './legacy-projects.service';

@Module({
  imports: [LegacyMysqlModule],
  controllers: [LegacyProjectsController],
  providers: [LegacyProjectsService],
})
export class LegacyProjectsModule {}
