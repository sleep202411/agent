import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AuthModule } from '../auth';
import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationModule } from '../notification';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import {
  CrewAssetsController,
  ProjectCrewAssetsController,
} from './assets/assets.controller';
import { CrewAssetAccessModule } from './assets/asset-access.module';
import { CrewAssetsService } from './assets/assets.service';
import { CrewAssetUploadCleanupWorker } from './assets/upload-cleanup.worker';
import { CrewAgreementsController } from './agreements/agreements.controller';
import { CrewAgreementsService } from './agreements/agreements.service';
import { CrewAgreementArchiveWorker } from './agreements/agreement-archive.worker';
import { CrewAgreementSendWorker } from './agreements/agreement-send.worker';
import { BoldSignAgreementProvider } from './agreements/boldsign-agreement.provider';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { CrewsAdminController } from './crews-admin.controller';
import { CrewPositionsAdminController } from './crew-positions-admin.controller';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { CrewInvitationsController } from './invitations/invitations.controller';
import { CrewInvitationsService } from './invitations/invitations.service';
import { CrewInviteLinksService } from './invitations/invite-links.service';
import {
  PositionsController,
  PositionsDiscoveryController,
} from './positions.controller';
import { PositionsService } from './positions.service';
import { CrewTasksController } from './tasks/tasks.controller';
import { CrewTasksService } from './tasks/tasks.service';
import { CrewTaskDraftService } from './tasks/task-draft.service';
import { CrewEarningsController } from './earnings/earnings.controller';
import { CrewEarningsService } from './earnings/earnings.service';
import { CrewPayoutsController } from './earnings/payouts.controller';
import { CrewPayoutsService } from './earnings/payouts.service';
import { CrewProductionController } from './production/production.controller';
import { CrewProductionService } from './production/production.service';

/**
 * Crew domain — server-owned, no Java dependency for any of these
 * endpoints. Java only contributes user identity (resolved by the
 * global AuthGuard before any of these controllers run).
 *
 * Import direction with ConversationsModule is ONE WAY: crews depend on
 * conversations to open the crew group chat and sync its participants.
 * ConversationsModule must never import CrewsModule — it re-checks crew
 * membership by querying `crewMember` through the @Global PrismaService,
 * precisely so this stays a DAG and needs no forwardRef.
 */
@Module({
  imports: [
    AuthModule,
    NotificationModule,
    UsersModule,
    AdminAuthModule,
    ConversationsModule,
    StorageModule,
    WorkspacesModule,
    CrewAssetAccessModule,
  ],
  controllers: [
    CrewsController,
    CrewsAdminController,
    CrewPositionsAdminController,
    PositionsController,
    PositionsDiscoveryController,
    ApplicationsController,
    MembersController,
    CrewAssetsController,
    ProjectCrewAssetsController,
    CrewInvitationsController,
    CrewTasksController,
    CrewProductionController,
    CrewAgreementsController,
    CrewEarningsController,
    CrewPayoutsController,
  ],
  providers: [
    CrewsService,
    PositionsService,
    ApplicationsService,
    MembersService,
    CrewAssetsService,
    CrewAssetUploadCleanupWorker,
    CrewCollaborationService,
    CrewInvitationsService,
    CrewInviteLinksService,
    CrewTasksService,
    CrewTaskDraftService,
    CrewProductionService,
    CrewAgreementsService,
    CrewAgreementSendWorker,
    CrewAgreementArchiveWorker,
    BoldSignAgreementProvider,
    CrewEarningsService,
    CrewPayoutsService,
  ],
  // The scope-agnostic InvitesController redeems crew link tokens.
  exports: [CrewAssetAccessModule, CrewInviteLinksService],
})
export class CrewsModule {}
