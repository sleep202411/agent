import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { NotificationModule } from '../notification';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StoryAccessModule } from './story-access.module';
import { StoryProjectInvitesService } from './story-project-invites.service';
import { StoryProjectMembersService } from './story-project-members.service';
import {
  StoryProjectInvitesController,
  StoryProjectMembersController,
} from './story-project-sharing.controller';

/**
 * Story-project sharing kept as a leaf module, like StoryAccessModule: the
 * scope-agnostic invite accept endpoint in SharingModule has to resolve story
 * tokens, and importing the full StoryStudioModule there would drag MediaModule
 * into the sharing graph. This module depends only on the authorization gate and
 * the shared identity/notification/seat services.
 */
@Module({
  imports: [
    StoryAccessModule,
    WorkspacesModule,
    UsersModule,
    NotificationModule,
    EntitlementsModule,
  ],
  controllers: [StoryProjectMembersController, StoryProjectInvitesController],
  providers: [StoryProjectMembersService, StoryProjectInvitesService],
  exports: [StoryProjectInvitesService],
})
export class StoryProjectSharingModule {}
