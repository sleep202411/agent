import { Module } from '@nestjs/common';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

/**
 * Story authorization is intentionally isolated from the rest of StoryStudio.
 * Media upload issuance needs the same project capability gate, while the full
 * StoryStudioModule already depends on MediaModule. Keeping this leaf module
 * free of media dependencies prevents a circular module graph and preserves a
 * single source of truth for `story.generate`.
 */
@Module({
  providers: [StoryProjectWriteGuardService, StoryPermissionService],
  exports: [StoryProjectWriteGuardService, StoryPermissionService],
})
export class StoryAccessModule {}
