import { Module } from '@nestjs/common';
import { LegacyMysqlModule } from '../infra/legacy-mysql';
import { LegacyCreatorsController } from './legacy-creators.controller';
import { LegacyCreatorsService } from './legacy-creators.service';

@Module({
  imports: [LegacyMysqlModule],
  controllers: [LegacyCreatorsController],
  providers: [LegacyCreatorsService],
  exports: [LegacyCreatorsService],
})
export class LegacyCreatorsModule {}
