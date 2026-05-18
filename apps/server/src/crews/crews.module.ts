import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { NotificationModule } from '../notification';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { CrewRoleService } from './crew-role.service';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PositionsController } from './positions.controller';
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
  imports: [AuthModule, NotificationModule],
  controllers: [
    CrewsController,
    PositionsController,
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
