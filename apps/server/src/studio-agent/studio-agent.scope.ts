import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StudioAgentThreadScopeSchema,
  type StudioAgentManifestRef,
  type StudioAgentScenarioManifest,
  type StudioAgentThreadScope,
} from '@repo/shared/studio-agent';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StudioAgentRegistry } from './studio-agent.registry';

export interface AuthorizedStudioAgentScope {
  scenario: StudioAgentScenarioManifest;
  scope: StudioAgentThreadScope;
  grantedScopes: ReadonlySet<string>;
}

/**
 * Product-neutral authorization entry point.
 *
 * A scenario is resolved first, then its owning product adapter validates the
 * resource graph. The runtime never receives membership tables or broad
 * credentials; it only sees the resulting capability manifests.
 */
@Injectable()
export class StudioAgentScopeAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: StudioAgentRegistry,
    private readonly storyPermissions: StoryPermissionService,
  ) {}

  async authorize(
    actorId: string,
    surfaceId: string,
    scenarioReference: StudioAgentManifestRef,
    rawScope: StudioAgentThreadScope,
  ): Promise<AuthorizedStudioAgentScope> {
    const scenario = this.registry.scenario(scenarioReference);
    if (scenario.surfaceId !== surfaceId) {
      throw new BadRequestException({
        code: 'STUDIO_AGENT_SURFACE_SCENARIO_MISMATCH',
        message: 'The selected scenario is not available on this surface.',
      });
    }

    const scope = StudioAgentThreadScopeSchema.parse(rawScope);
    switch (scenario.scenarioId) {
      case 'story.studio.assistant':
        return this.authorizeStory(actorId, scenario, scope);
      default:
        throw new BadRequestException({
          code: 'STUDIO_AGENT_SCENARIO_SCOPE_UNSUPPORTED',
          message: 'No scope adapter is registered for this scenario.',
        });
    }
  }

  private async authorizeStory(
    actorId: string,
    scenario: StudioAgentScenarioManifest,
    scope: StudioAgentThreadScope,
  ): Promise<AuthorizedStudioAgentScope> {
    if (scope.container.resourceType !== 'story.project') {
      throw new BadRequestException({
        code: 'STUDIO_AGENT_STORY_CONTAINER_INVALID',
        message: 'StoryOS requires a story project container.',
      });
    }

    const { project, capabilities } =
      await this.storyPermissions.requireProject(
        actorId,
        scope.container.resourceId,
        'story.read',
      );
    if (project.workspaceId !== scope.workspaceId) {
      // Keep cross-tenant resource existence private.
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }

    if (scope.focus !== null) {
      if (scope.focus.resourceType !== 'story.chapter') {
        throw new BadRequestException({
          code: 'STUDIO_AGENT_STORY_FOCUS_INVALID',
          message: 'StoryOS focus must reference a story chapter.',
        });
      }
      const chapter = await this.prisma.storyChapter.findFirst({
        where: {
          id: scope.focus.resourceId,
          storyProjectId: project.id,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!chapter) {
        throw new NotFoundException({
          code: 'STORY_CHAPTER_NOT_FOUND',
          message: 'Story chapter not found.',
        });
      }
    }

    return {
      scenario,
      scope,
      grantedScopes: new Set(['studio.read', ...capabilities]),
    };
  }
}
