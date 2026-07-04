import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AppReleaseAdminController } from './app-release-admin.controller';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';

// PrismaService comes from the global DbModule; AdminAuthModule provides the
// guards used by the admin controller.
@Module({
  imports: [AdminAuthModule],
  controllers: [AppReleaseController, AppReleaseAdminController],
  providers: [AppReleaseService],
})
export class AppReleaseModule {}
