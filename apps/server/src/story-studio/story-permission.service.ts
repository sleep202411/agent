import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  type WorkspaceMemberRole,
  type Prisma,
  type StoryProject,
} from '@prisma/client';
import {
  CREW_STUDIO_MEMBER_SELECT,
  crewStudioRoleForMember,
  resolveCrewStudioAccess,
} from '../workspaces/crew-studio-access';
import { PrismaService } from '../infra/db/db.module';
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
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  capabilities(role: StoryProjectMemberRole): StoryCapability[] {
    return [...ROLE_CAPABILITIES[role]];
  }

  /** Workspace administration grants project administration; ownership remains explicit. */
  workspaceRole(
    role: WorkspaceMemberRole | undefined,
  ): StoryProjectMemberRole | null {
    switch (role) {
      case 'owner':
      case 'admin':
        return StoryProjectMemberRole.owner;
      case 'editor':
        return StoryProjectMemberRole.editor;
      case 'billing':
      case 'viewer':
        return StoryProjectMemberRole.viewer;
      default:
        return null;
    }
  }

  /** Workspace access is the baseline; direct project grants can only add capabilities. */
  effectiveAccess(
    directRole: StoryProjectMemberRole | undefined,
    workspaceRole: WorkspaceMemberRole | undefined,
    crewRole?: 'viewer' | 'editor',
  ): { role: StoryProjectMemberRole; capabilities: StoryCapability[] } | null {
    const inherited = this.workspaceRole(workspaceRole);
    const roles = [directRole, inherited, this.workspaceRole(crewRole)].filter(
      (role): role is StoryProjectMemberRole => Boolean(role),
    );
    if (!roles.length) return null;
    const role = roles.reduce((best, current) =>
      ROLE_CAPABILITIES[current].length > ROLE_CAPABILITIES[best].length
        ? current
        : best,
    );
    return {
      role,
      capabilities: [
        ...new Set(roles.flatMap((item) => this.capabilities(item))),
      ],
    };
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
        workspace: { status: 'active', deletedAt: null },
        OR: [
          {
            workspace: {
              studioCrew: {
                deletedAt: null,
                members: { some: { userId, status: 'active' } },
              },
            },
          },
          { members: { some: { userId, status: 'active', removedAt: null } } },
          {
            workspace: {
              members: {
                some: {
                  userId,
                  status: 'active',
                  removedAt: null,
                  accessScope: 'workspace',
                },
              },
            },
          },
        ],
      },
      include: {
        workspace: {
          select: {
            studioCrew: {
              select: {
                id: true,
                deletedAt: true,
                members: {
                  where: { userId, status: 'active' },
                  select: CREW_STUDIO_MEMBER_SELECT,
                  take: 1,
                },
              },
            },
            members: {
              where: {
                userId,
                status: 'active',
                removedAt: null,
                accessScope: 'workspace',
              },
              select: { role: true },
              take: 1,
            },
          },
        },
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
    const { members, workspace, ...projectRow } = project;
    const access = this.effectiveAccess(
      members[0]?.role,
      workspace.members[0]?.role,
      workspace.studioCrew &&
        !workspace.studioCrew.deletedAt &&
        workspace.studioCrew.members[0]
        ? crewStudioRoleForMember(
            workspace.studioCrew.id,
            userId,
            workspace.studioCrew.members[0],
          )
        : undefined,
    );
    if (!access) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }

    const { role, capabilities } = access;
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

  /**
   * Re-check authorization on the same transaction snapshot that will mutate
   * canonical Story state. Agent actions use this after acquiring the project
   * write row so a concurrent membership removal cannot slip through the
   * authorization/mutation boundary.
   *
   * This intentionally does not call the advisory early write guard: the
   * caller already owns the authoritative transaction-level write fence.
   */
  async requireProjectInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    storyProjectId: string,
    capability: StoryCapability,
  ): Promise<{
    project: StoryProject;
    role: StoryProjectMemberRole;
    capabilities: StoryCapability[];
  }> {
    const projects = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT project.id FROM story_projects AS project
      JOIN workspaces AS workspace ON workspace.id = project.workspace_id
      WHERE project.id = ${storyProjectId}::uuid AND project.status = 'active'
        AND workspace.status = 'active' AND workspace.deleted_at IS NULL
      FOR UPDATE OF project FOR SHARE OF workspace
    `;
    const project =
      projects.length === 1
        ? await tx.storyProject.findUnique({ where: { id: storyProjectId } })
        : null;
    if (!project) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    const direct = await tx.$queryRaw<Array<{ role: StoryProjectMemberRole }>>`
      SELECT role FROM story_project_members
      WHERE story_project_id = ${storyProjectId}::uuid AND user_id = ${userId}
        AND status = 'active' AND removed_at IS NULL FOR SHARE
    `;
    const members = await tx.$queryRaw<Array<{ role: WorkspaceMemberRole }>>`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${project.workspaceId}::uuid AND user_id = ${userId}
        AND status = 'active' AND removed_at IS NULL AND access_scope = 'workspace'
      FOR SHARE
    `;
    // Lock the grant sources on the same transaction as the Story write.
    // Membership edits update the member version; unlink/deletion update crew.
    await tx.$queryRaw`
      SELECT crew.id FROM crews AS crew
      JOIN crew_members AS member ON member.crew_id = crew.id
      WHERE crew.studio_workspace_id = ${project.workspaceId}::uuid
        AND crew.deleted_at IS NULL AND member.user_id = ${userId}
        AND member.status = 'active'
      FOR SHARE OF crew, member
    `;
    const inheritedCrew = await resolveCrewStudioAccess(
      tx,
      project.workspaceId,
      userId,
    );
    const access = this.effectiveAccess(
      direct[0]?.role,
      members[0]?.role,
      inheritedCrew?.role,
    );
    if (!access) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    const { role, capabilities } = access;
    if (!capabilities.includes(capability)) {
      throw new ForbiddenException({
        code: 'STORY_PERMISSION_DENIED',
        message: 'You do not have permission to perform this story action.',
      });
    }
    return { project, role, capabilities };
  }
}
