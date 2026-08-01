import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth';
import { CrewRoleService } from '../crews/crew-role.service';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import {
  type AgentConversationScopeRequest,
  type AuthorizedAgentScope,
} from './agent-platform-gateway.dto';

@Injectable()
export class AgentPlatformAuthorizationService {
  constructor(
    private readonly storyPermissions: StoryPermissionService,
    private readonly crewRoles: CrewRoleService,
  ) {}

  async authorize(
    user: AuthUser,
    request: AgentConversationScopeRequest,
  ): Promise<AuthorizedAgentScope> {
    // The crew Agent waits on the crew module's own refactor. This is the only
    // place a scoped Agent context is signed, so refusing here makes the crew
    // tools unreachable rather than merely absent from the UI — a crafted
    // request from a user who legitimately holds crew.manage cannot drive them
    // either. The capability pack, its tools, and the crew branch below stay
    // intact; delete this guard and nothing else once the refactor lands.
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

    const role = await this.crewRoles.require(request.crewId, user.userId, [
      'admin',
      'finance',
      'member',
    ]);
    const scope = Object.freeze({
      kind: 'crew' as const,
      crewId: request.crewId,
    });
    return Object.freeze({
      actorId: user.userId,
      actorDisplayName: displayName(user),
      surface: request.surface,
      scope,
      locale: request.locale,
      roles: Object.freeze([`crew.${role}`]),
      permissions: Object.freeze([
        'crew.read',
        ...(role === 'admin' ? ['crew.manage'] : []),
        ...(role === 'finance' || role === 'admin' ? ['crew.finance'] : []),
      ]),
    });
  }
}

/**
 * Takes the surface widened to `string` on purpose. Comparing the discriminant
 * directly would narrow `request` to `never` past the story branch and strip
 * the crew resolution of its types; that code has to stay type-checked so it is
 * ready to re-enable unchanged.
 */
function isCrewSurface(surface: string): boolean {
  return surface === 'crew-management';
}

function displayName(user: AuthUser): string {
  const value = user.nickName?.trim() || user.userName?.trim() || user.userId;
  return value.slice(0, 120);
}
