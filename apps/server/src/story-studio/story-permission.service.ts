import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  WorkspaceMemberRole,
  type StoryProject,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

export type StoryCapability =
  | 'story.read'
  | 'story.edit'
  | 'story.generate'
  | 'story.review'
  | 'story.build'
  | 'story.release'
  | 'story.admin';

const ROLE_CAPABILITIES: Record<
  StoryProjectMemberRole,
  readonly StoryCapability[]
> = {
  [StoryProjectMemberRole.owner]: [
    'story.read',
    'story.edit',
    'story.generate',
    'story.review',
    'story.build',
    'story.release',
    'story.admin',
  ],
  [StoryProjectMemberRole.producer]: [
    'story.read',
    'story.edit',
    'story.generate',
    'story.review',
    'story.build',
    'story.release',
  ],
  [StoryProjectMemberRole.editor]: [
    'story.read',
    'story.edit',
    'story.generate',
  ],
  [StoryProjectMemberRole.reviewer]: ['story.read', 'story.review'],
  [StoryProjectMemberRole.viewer]: ['story.read'],
};

const WRITE_CAPABILITIES = new Set<StoryCapability>([
  'story.edit',
  'story.generate',
  'story.review',
  'story.build',
  'story.release',
  'story.admin',
]);

@Injectable()
export class StoryPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  capabilities(role: StoryProjectMemberRole): StoryCapability[] {
    return [...ROLE_CAPABILITIES[role]];
  }

  async requireProject(
    userId: string,
    storyProjectId: string,
    capability: StoryCapability,
    options: { allowArchived?: boolean } = {},
  ): Promise<{
    project: StoryProject;
    role: StoryProjectMemberRole;
    capabilities: StoryCapability[];
  }> {
    const project = await this.prisma.storyProject.findFirst({
      where: {
        id: storyProjectId,
        ...(options.allowArchived ? {} : { status: StoryProjectStatus.active }),
        members: {
          some: {
            userId,
            status: StoryProjectMemberStatus.active,
            removedAt: null,
          },
        },
      },
      include: {
        members: {
          where: {
            userId,
            status: StoryProjectMemberStatus.active,
            removedAt: null,
          },
          take: 1,
        },
      },
    });

    if (!project) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    const { members, ...projectRow } = project;
    if (members.length !== 1) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }

    // Story membership never grants access outside the owning tenant.
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      project.workspaceId,
      WorkspaceMemberRole.viewer,
    );

    const role = members[0].role;
    const capabilities = this.capabilities(role);
    if (!capabilities.includes(capability)) {
      throw new ForbiddenException({
        code: 'STORY_PERMISSION_DENIED',
        message: 'You do not have permission to perform this story action.',
      });
    }

    // Give every write-capable command an early, consistent 423 before it does
    // expensive preparation. This is advisory only: the short transaction ends
    // here, so the mutation service must repeat the guard inside its write
    // transaction to be authoritative.
    if (WRITE_CAPABILITIES.has(capability)) {
      await this.writeGuard.assertHumanWriteAllowedEarly(storyProjectId);
    }

    return { project: projectRow, role, capabilities };
  }
}
