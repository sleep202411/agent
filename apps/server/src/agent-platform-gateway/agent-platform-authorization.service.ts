import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import {
  type AgentConversationScopeRequest,
  type AuthorizedAgentScope,
} from './agent-platform-gateway.dto';

@Injectable()
export class AgentPlatformAuthorizationService {
  constructor(private readonly storyPermissions: StoryPermissionService) {}

  async authorize(
    user: AuthUser,
    request: AgentConversationScopeRequest,
  ): Promise<AuthorizedAgentScope> {
    // Crew collaboration is served by the authoritative Crew HTTP domain.
    // No Crew Agent context is signed until a capability pack is deliberately
    // designed against that current domain contract.
    if (isCrewSurface(request.surface)) {
      throw new NotFoundException({
        code: 'AGENT_SURFACE_UNAVAILABLE',
        message: 'The crew Agent surface is not available yet.',
      });
    }
    if (request.surface === 'story-studio') {
      const authorization = await this.storyPermissions.requireProject(
        user.userId,
        request.projectId,
        'story.read',
      );
      if (authorization.project.workspaceId !== request.workspaceId) {
        throw new NotFoundException({
          code: 'STORY_PROJECT_NOT_FOUND',
          message: 'Story project not found.',
        });
      }
      const scope = Object.freeze({
        kind: 'story-project' as const,
        workspaceId: request.workspaceId,
        projectId: request.projectId,
      });
      return Object.freeze({
        actorId: user.userId,
        actorDisplayName: displayName(user),
        surface: request.surface,
        scope,
        locale: request.locale,
        roles: Object.freeze([`story.${authorization.role}`]),
        permissions: Object.freeze(
          [
            authorization.capabilities.includes('story.read')
              ? 'story.read'
              : null,
            authorization.capabilities.includes('story.edit')
              ? 'story.write'
              : null,
          ].filter((permission): permission is string => permission !== null),
        ),
      });
    }

    throw new NotFoundException({
      code: 'AGENT_SURFACE_UNAVAILABLE',
      message: 'The requested Agent surface is not available.',
    });
  }
}

/**
 * Kept as a named boundary so the unsupported surface cannot accidentally be
 * admitted while adding another Story surface.
 */
function isCrewSurface(surface: string): boolean {
  return surface === 'crew-management';
}

function displayName(user: AuthUser): string {
  const value = user.nickName?.trim() || user.userName?.trim() || user.userId;
  return value.slice(0, 120);
}
