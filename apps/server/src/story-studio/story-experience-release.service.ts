import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceReleaseResponse,
} from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import type { PublishStoryBuildInput } from './dto';
import { createExperienceReleaseRequest } from './experience-release-request';
import { StoryExperienceReleaseGateway } from './story-experience-release.gateway';
import { StoryFilmBuildService } from './story-film-build.service';
import { StoryPermissionService } from './story-permission.service';

@Injectable()
export class StoryExperienceReleaseService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly builds: StoryFilmBuildService,
    private readonly gateway: StoryExperienceReleaseGateway,
  ) {}

  async publishBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    buildId: string,
    input: PublishStoryBuildInput,
    auth: { cookie?: string; authorization?: string },
  ): Promise<ExperienceReleaseResponse> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new ConflictException({
        code: 'STORY_PROJECT_SCOPE_MISMATCH',
        message: 'Story project does not belong to the active workspace.',
      });
    }
    const build = await this.builds.getBuild(
      user,
      workspaceId,
      projectId,
      buildId,
    );
    if (
      build.status !== 'ready' ||
      build.profile !== 'production' ||
      build.scope.kind !== 'full' ||
      build.runtimeSchemaVersion !== 2 ||
      !build.runtimeJson
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_BUILD_NOT_PUBLISHABLE',
        message:
          'Only a ready production/full Runtime Manifest v2 Build with available frozen media can be published.',
      });
    }
    const manifest = ExperienceRuntimeManifestSchema.parse(build.runtimeJson);
    if (manifest.buildId !== build.id || manifest.channel !== 'production') {
      throw new ConflictException({
        code: 'STORY_BUILD_MANIFEST_IDENTITY_MISMATCH',
        message:
          'The frozen Runtime Manifest identity does not match its Build.',
      });
    }
    const title = localizedText(
      manifest.metadata.title,
      manifest.localization.defaultLocale,
    );
    const subtitle = manifest.metadata.summary
      ? localizedText(
          manifest.metadata.summary,
          manifest.localization.defaultLocale,
        )
      : undefined;
    const request = createExperienceReleaseRequest(
      {
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        title,
        ...(subtitle ? { subtitle } : {}),
        status: input.status,
        setCurrent: input.setCurrent,
      },
      manifest,
    );
    return this.gateway.publish(request, auth);
  }
}

function localizedText(
  value: Record<string, string>,
  defaultLocale: string,
): string {
  return value[defaultLocale] ?? Object.values(value)[0];
}
