import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { StorageModule } from '../infra/storage/storage.module';
import { CertificatesAdminController } from './certificates-admin.controller';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [AdminAuthModule, StorageModule],
  controllers: [CertificatesController, CertificatesAdminController],
  providers: [CertificatesService],
})
export class CertificatesModule {}
