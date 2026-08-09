import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import type { AgentProjectKind } from '@repo/agent-capabilities';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';

export interface AgentOsProjectContext {
  projectId: string;
  projectKind: AgentProjectKind;
  workspaceId: string;
}

/**
 * The authoritative Agent OS project boundary.
 *
 * Browser and worker payloads identify projects by id. Only Nest may resolve
 * that id to a product kind and authorize access to its backing store.
 */
@Injectable()
export class AgentOsProjectContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async resolve(projectId: string): Promise<AgentOsProjectContext> {
    const platform = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (platform) {
      return {
        projectId: platform.id,
        projectKind: 'platform',
        workspaceId: platform.workspaceId,
      };
    }

    const story = await this.prisma.storyProject.findFirst({
      where: { id: projectId },
      select: { id: true, workspaceId: true },
    });
    if (story) {
      return {
        projectId: story.id,
        projectKind: 'story',
        workspaceId: story.workspaceId,
      };
    }

    throw new NotFoundException({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found.',
    });
  }

  async requireRead(
    actorId: string,
    projectId: string,
  ): Promise<AgentOsProjectContext> {
    const context = await this.resolve(projectId);
    await this.authorizeRead(actorId, context);
    return context;
  }

  async requireWrite(
    actorId: string,
    projectId: string,
  ): Promise<AgentOsProjectContext> {
    const context = await this.resolve(projectId);
    await this.authorizeWrite(actorId, context);
    return context;
  }

  /** Resolve the selected Story chapter without trusting client ownership claims. */
  async requireStoryWorkbenchContext(
    projectId: string,
    context: { chapterId: string } | undefined,
  ): Promise<Readonly<Record<string, string>>> {
    if (!context) {
      throw new BadRequestException({
        code: 'AGENT_OS_STORY_CHAPTER_REQUIRED',
        message: 'Story workbench mode requires the active chapter.',
      });
    }
    const chapter = await this.prisma.storyChapter.findFirst({
      where: {
        id: context.chapterId,
        storyProjectId: projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'The selected Story chapter was not found in this project.',
      });
    }
    return { chapterId: chapter.id };
  }

  /** Resolve a Platform section and its canvas without trusting client ownership. */
  async requirePlatformWorkbenchContext(
    projectId: string,
    context: { sectionId: string } | undefined,
  ): Promise<Readonly<Record<string, string>>> {
    if (!context) {
      throw new BadRequestException({
        code: 'AGENT_OS_PLATFORM_SECTION_REQUIRED',
        message: 'Canvas and storyboard modes require the active chapter.',
      });
    }
    const section = await this.prisma.platformProjectSection.findFirst({
      where: { id: context.sectionId, projectId, archivedAt: null },
      select: {
        id: true,
        documents: {
          where: {
            type: 'canvas',
            status: 'active',
            deletedAt: null,
          },
          select: { id: true },
        },
      },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'PROJECT_SECTION_NOT_FOUND',
        message: 'The selected chapter was not found in this project.',
      });
    }
    if (section.documents.length !== 1) {
      throw new NotFoundException({
        code: 'PROJECT_SECTION_CANVAS_NOT_FOUND',
        message: 'The selected chapter has no active canvas document.',
      });
    }
    return { sectionId: section.id, canvasDocumentId: section.documents[0].id };
  }

  async authorizeRead(
    actorId: string,
    context: Pick<AgentOsProjectContext, 'projectId' | 'projectKind'>,
  ): Promise<void> {
    if (context.projectKind === 'platform') {
      await this.workspacePermissions.requireProjectRole(
        actorId,
        context.projectId,
        ProjectMemberRole.viewer,
      );
      return;
    }
    await this.storyPermissions.requireProject(
      actorId,
      context.projectId,
      'story.read',
    );
  }

  async authorizeWrite(
    actorId: string,
    context: Pick<AgentOsProjectContext, 'projectId' | 'projectKind'>,
  ): Promise<void> {
    if (context.projectKind === 'platform') {
      await this.workspacePermissions.requireProjectRole(
        actorId,
        context.projectId,
        ProjectMemberRole.editor,
      );
      return;
    }
    await this.storyPermissions.requireProject(
      actorId,
      context.projectId,
      'story.edit',
    );
  }
}
