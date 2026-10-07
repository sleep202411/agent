import { TaskPaymentsService } from './tasks/task-payments.service';
import { TaskPaymentsController } from './tasks/task-payments.controller';
import {
  CrewTaskContractsController,
  CrewTaskContractsService,
} from './tasks/task-contracts';
import { DocumentsModule } from '../documents/documents.module';
import { RealtimeRevokeModule } from '../infra/realtime/realtime-revoke.module';
import { CrewStudioRevocationService } from './production/crew-studio-revocation.service';
import {
  CrewCanvasTaskImportController,
  CrewCanvasTaskImportService,
} from './production/canvas-task-import';
import {
  EpisodeTaskTemplateController,
  EpisodeTaskTemplateService,
} from './templates/episode-task-template';
import { CrewComputeRequestsAdminController } from './compute-requests/compute-requests-admin.controller';
import { CrewComputeRequestsController } from './compute-requests/compute-requests.controller';
import { CrewComputeRequestsService } from './compute-requests/compute-requests.service';
import {
  ProjectStoryboardChildrenController,
  StoryStoryboardChildrenController,
} from './storyboard/storyboard-children.controller';
import { StoryboardChildrenService } from './storyboard/storyboard-children.service';
import { ProjectTaskTemplateService } from './templates/project-task-template.service';
import {
  ProjectTaskTemplatesAdminController,
  TaskTemplatesAdminAliasController,
} from './templates/project-task-templates-admin.controller';
import {
  CrewApplicationAmendmentsController,
  CrewAmendmentSettlementQueueController,
  CrewApplicationAmendmentsService,
} from './application-amendments';
import {
  CrewTaskFeedbackAppealsService,
  CrewTaskFeedbackAppealsController,
} from './accountability/task-feedback-appeals';
import { CrewTaskOverdueWorker } from './tasks/task-overdue.worker';
import {
  CrewDisputeAttachmentsService,
  CrewDisputeAttachmentsController,
  CrewDisputeDraftAttachmentsController,
  CrewDisputeAttachmentsAdminController,
} from './tasks/dispute-attachments';
import {
  CrewTaskDisputesService,
  CrewTaskDisputesController,
  CrewTaskDisputesAdminController,
} from './tasks/task-disputes';
import {
  CrewTaskExtensionsController,
  CrewTaskExtensionsService,
} from './tasks/task-extensions';
import {
  CrewApplicationInterviewsController,
  CrewApplicationInterviewsService,
} from './application-interviews';
import {
  CrewPositionInvitationsController,
  CrewPositionInvitationsService,
} from './position-invitations';
import {
  CrewApplicationTermsController,
  CrewApplicationTermsService,
} from './application-terms';
import {
  CrewTaskFeedbackController,
  CrewTaskFeedbackService,
} from './accountability/task-feedback';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { StoryCrewAssetsController } from './assets/story-crew-assets.controller';
import { CrewStudioWorkspaceService } from './production/studio-workspace.service';
import { CrewStudioWorkspaceController } from './production/studio-workspace.controller';
import { CrewAccountabilityController } from './accountability/accountability.controller';
import { CrewAccountabilityService } from './accountability/accountability.service';
import {
  CrewTrustAppealController,
  CrewTrustAppealService,
} from './tasks/trust-appeals';
import {
  CrewExpenseReceiptService,
  CrewExpenseReceiptController,
  CrewExpenseReceiptAdminController,
} from './expenses/expense-receipts';
import {
  CrewExpenseSubmissionAdminController,
  CrewExpenseDraftController,
  CrewExpenseDraftService,
} from './expenses/expense-drafts';
import {
  CrewDeliveryCatalogAdminController,
  CrewDeliveryCatalogController,
  CrewDeliveryCatalogService,
} from './tasks/delivery-catalog';
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
  CrewQualificationsService,
  CrewQualificationCatalogController,
} from './crew-qualifications.service';
import {
  CrewAssetsController,
  ProjectCrewAssetsController,
  CanvasCrewAssetsController,
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
    DocumentsModule,
    RealtimeRevokeModule,
    StoryAccessModule,
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
    TaskPaymentsController,
    CrewQualificationCatalogController,
    EpisodeTaskTemplateController,
    CrewApplicationAmendmentsController,
    CrewAmendmentSettlementQueueController,
    CrewTaskFeedbackAppealsController,
    CrewDisputeAttachmentsController,
    CrewDisputeDraftAttachmentsController,
    CrewDisputeAttachmentsAdminController,
    CrewTaskDisputesController,
    CrewTaskDisputesAdminController,
    CrewTaskExtensionsController,
    CrewApplicationInterviewsController,
    CrewPositionInvitationsController,
    CrewApplicationTermsController,
    CrewTaskFeedbackController,
    CrewStudioWorkspaceController,
    StoryCrewAssetsController,
    CrewAccountabilityController,
    CrewTrustAppealController,
    CrewExpenseReceiptController,
    CrewExpenseReceiptAdminController,
    CrewExpenseSubmissionAdminController,
    CrewExpenseDraftController,
    CrewDeliveryCatalogController,
    CrewDeliveryCatalogAdminController,
    CrewsController,
    CrewsAdminController,
    CrewPositionsAdminController,
    PositionsController,
    PositionsDiscoveryController,
    ApplicationsController,
    MembersController,
    CrewAssetsController,
    ProjectCrewAssetsController,
    CanvasCrewAssetsController,
    CrewInvitationsController,
    CrewTasksController,
    CrewTaskContractsController,
    CrewProductionController,
    CrewCanvasTaskImportController,
    CrewAgreementsController,
    CrewEarningsController,
    CrewComputeRequestsController,
    CrewComputeRequestsAdminController,
    CrewPayoutsController,
    ProjectTaskTemplatesAdminController,
    TaskTemplatesAdminAliasController,
    ProjectStoryboardChildrenController,
    StoryStoryboardChildrenController,
  ],
  providers: [
    TaskPaymentsService,
    CrewStudioRevocationService,
    EpisodeTaskTemplateService,
    StoryboardChildrenService,
    CrewApplicationAmendmentsService,
    CrewTaskFeedbackAppealsService,
    CrewTaskOverdueWorker,
    CrewDisputeAttachmentsService,
    CrewTaskDisputesService,
    CrewTaskExtensionsService,
    CrewApplicationInterviewsService,
    CrewPositionInvitationsService,
    CrewApplicationTermsService,
    CrewTaskFeedbackService,
    CrewStudioWorkspaceService,
    CrewAccountabilityService,
    CrewTrustAppealService,
    CrewExpenseReceiptService,
    CrewExpenseDraftService,
    CrewDeliveryCatalogService,
    CrewsService,
    PositionsService,
    ApplicationsService,
    CrewQualificationsService,
    MembersService,
    CrewAssetsService,
    CrewAssetUploadCleanupWorker,
    CrewCollaborationService,
    CrewInvitationsService,
    CrewInviteLinksService,
    CrewTasksService,
    CrewTaskContractsService,
    CrewTaskDraftService,
    CrewProductionService,
    CrewCanvasTaskImportService,
    CrewAgreementsService,
    CrewAgreementSendWorker,
    CrewAgreementArchiveWorker,
    BoldSignAgreementProvider,
    CrewEarningsService,
    CrewComputeRequestsService,
    CrewPayoutsService,
    ProjectTaskTemplateService,
  ],
  // The scope-agnostic InvitesController redeems crew link tokens.
  exports: [
    CrewAssetAccessModule,
    CrewInviteLinksService,
    ProjectTaskTemplateService,
  ],
})
export class CrewsModule {}
