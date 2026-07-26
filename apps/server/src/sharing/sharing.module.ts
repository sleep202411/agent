import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { CharactersModule } from '../characters/characters.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationModule } from '../notification';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces';
import { RealtimeRevokeModule } from '../infra/realtime/realtime-revoke.module';
import { StoryProjectSharingModule } from '../story-studio/story-project-sharing.module';
import { InvitesController } from './invites.controller';
import { ProjectInvitesController } from './project-invites.controller';
import { ProjectInvitesService } from './project-invites.service';
import { ProjectMembersController } from './project-members.controller';
import { ProjectMembersService } from './project-members.service';
import { WorkspaceInvitesController } from './workspace-invites.controller';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceMembersService } from './workspace-members.service';

/**
 * Sharing / team collaboration — membership + invites for workspaces and
 * projects. Decoupled from the WorkspacesService god-service; reuses its
 * exported WorkspacePermissionService + PlatformAuditLogService (via
 * WorkspacesModule), plus NotificationService + UsersService.
 *
 * Two surfaces per scope: add-by-account membership (immediate) and shareable
 * invite links (token, accept later). The scope-agnostic InvitesController
 * resolves a raw token to either scope for preview/accept.
 */
@Module({
  imports: [
    AuthModule,
    DocumentsModule,
    NotificationModule,
    UsersModule,
    WorkspacesModule,
    RealtimeRevokeModule,
    // v2: project-member removal withdraws the removed user's real_person
    // grants for that project. Acyclic — characters does not import sharing.
    CharactersModule,
    // The scope-agnostic InvitesController resolves story-project tokens too.
    StoryProjectSharingModule,
  ],
  controllers: [
    WorkspaceMembersController,
    ProjectMembersController,
    WorkspaceInvitesController,
    ProjectInvitesController,
    InvitesController,
  ],
  providers: [
    WorkspaceMembersService,
    ProjectMembersService,
    WorkspaceInvitesService,
    ProjectInvitesService,
  ],
})
export class SharingModule {}
