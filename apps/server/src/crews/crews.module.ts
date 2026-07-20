import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AuthModule } from '../auth';
import { NotificationModule } from '../notification';
import { UsersModule } from '../users/users.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { CrewRoleService } from './crew-role.service';
import { CrewsAdminController } from './crews-admin.controller';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import {
  PositionsController,
  PositionsDiscoveryController,
} from './positions.controller';
import { PositionsService } from './positions.service';

/**
 * Crew domain — server-owned, no Java dependency for any of these
 * endpoints. Java only contributes user identity (resolved by the
 * global AuthGuard before any of these controllers run).
 *
 * Episode + assignment endpoints live under crews/episodes/ — added in
 * a separate sub-module to keep import boundaries readable. (See
 * EpisodesModule.)
 */
@Module({
  imports: [AuthModule, NotificationModule, UsersModule, AdminAuthModule],
  controllers: [
    CrewsController,
    CrewsAdminController,
    PositionsController,
    PositionsDiscoveryController,
    ApplicationsController,
    MembersController,
  ],
  providers: [
    CrewsService,
    PositionsService,
    ApplicationsService,
    MembersService,
    CrewRoleService,
  ],
  exports: [CrewRoleService],
})
export class CrewsModule {}
