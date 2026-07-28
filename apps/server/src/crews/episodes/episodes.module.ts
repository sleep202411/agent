import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { ConversationsModule } from '../../conversations/conversations.module';
import { NotificationModule } from '../../notification';
import { CrewRoleService } from '../crew-role.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';

/**
 * Episode sub-domain — split out from CrewsModule for import clarity
 * (different URL prefix, different state machine, different role
 * matrix). Provides CrewRoleService locally so it doesn't have to be
 * pulled from CrewsModule's exports (avoids a circular import path).
 *
 * Imports ConversationsModule so assignment status changes surface as
 * system messages in the crew group chat. One-way, same as CrewsModule.
 */
@Module({
  imports: [AuthModule, NotificationModule, ConversationsModule],
  controllers: [EpisodesController, AssignmentsController],
  providers: [EpisodesService, AssignmentsService, CrewRoleService],
})
export class EpisodesModule {}
