import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AcademyAuthorityService } from './academy-authority.service';
import { AcademyMappingsService } from './academy-mappings.service';
import {
  AcademyAdminController,
  AcademyPublicController,
} from './academy.controller';

@Module({
  imports: [AdminAuthModule],
  providers: [AcademyAuthorityService, AcademyMappingsService],
  controllers: [AcademyAdminController, AcademyPublicController],
})
export class AcademyModule {}
