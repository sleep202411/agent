import { LegacyCreatorsModule } from '../legacy-creators/legacy-creators.module';
import { AcademyLearningService } from './academy-learning.service';
import {
  AcademyAccessController,
  AcademyLearningAdminController,
  AcademyLearningController,
  AcademyOfferingController,
} from './academy-learning.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StorageModule } from '../infra/storage/storage.module';
import {
  Module,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AcademyAuthorityService } from './academy-authority.service';
import { AcademyMappingsService } from './academy-mappings.service';
import {
  AcademyAdminController,
  AcademyPublicController,
} from './academy.controller';

@Module({
  imports: [
    AdminAuthModule,
    WorkspacesModule,
    StorageModule,
    LegacyCreatorsModule,
  ],
  providers: [
    AcademyAuthorityService,
    AcademyMappingsService,
    AcademyLearningService,
  ],
  controllers: [
    AcademyAdminController,
    AcademyPublicController,
    AcademyAccessController,
    AcademyLearningController,
    AcademyOfferingController,
    AcademyLearningAdminController,
  ],
})
export class AcademyModule implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly learning: AcademyLearningService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.learning
        .retryBadges()
        .catch(() => undefined)
        .finally(() => {
          this.running = false;
        });
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
