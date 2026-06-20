import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces';
import { InternalPointsController } from './internal-points.controller';
import { InternalPointsService } from './internal-points.service';
import { ServiceTokenGuard } from './service-token.guard';

/**
 * Internal (machine-to-machine) API surface — currently the Java points bridge.
 * Auth is the shared service token (ServiceTokenGuard), not user/admin auth.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [InternalPointsController],
  providers: [InternalPointsService, ServiceTokenGuard],
})
export class InternalModule {}
