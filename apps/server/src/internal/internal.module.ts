import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces';
import { InternalPointsController } from './internal-points.controller';
import { PointsController } from './points.controller';
import { InternalPointsService } from './internal-points.service';
import { ServiceTokenGuard } from './service-token.guard';

/**
 * Internal (machine-to-machine) API surface — the Java points bridge, guarded by
 * the shared service token. Also hosts PointsController: a user-facing (satoken)
 * read of the same migration state, reusing InternalPointsService.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [InternalPointsController, PointsController],
  providers: [InternalPointsService, ServiceTokenGuard],
})
export class InternalModule {}
