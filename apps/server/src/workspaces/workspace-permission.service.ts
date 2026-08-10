import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformProjectStatus,
  ProjectMemberRole,
  ProjectMemberStatus,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
  type PlatformProject,
  type WorkspaceMember,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

const WORKSPACE_ROLE_RANK: Record<WorkspaceMemberRole, number> = {
  [WorkspaceMemberRole.owner]: 100,
  [WorkspaceMemberRole.admin]: 80,
  [WorkspaceMemberRole.billing]: 60,
  [WorkspaceMemberRole.editor]: 50,
  [WorkspaceMemberRole.viewer]: 10,
};

const PROJECT_ROLE_RANK: Record<ProjectMemberRole, number> = {
  [ProjectMemberRole.owner]: 100,
  [ProjectMemberRole.admin]: 80,
  [ProjectMemberRole.editor]: 50,
  [ProjectMemberRole.viewer]: 10,
};

/**
 * Maps a workspace role onto the effective project role it grants via the
 * `requireProjectRole` fallback (by the rank gates that fallback applies):
 * admin-capable roles map to admin, creator roles map to editor, and billing
 * stays read-only. Billing access never consumes or bypasses a creator seat.
 */
const WORKSPACE_TO_PROJECT_ROLE: Record<
  WorkspaceMemberRole,
  ProjectMemberRole
> = {
  [WorkspaceMemberRole.owner]: ProjectMemberRole.owner,
  [WorkspaceMemberRole.admin]: ProjectMemberRole.admin,
  [WorkspaceMemberRole.billing]: ProjectMemberRole.viewer,
  [WorkspaceMemberRole.editor]: ProjectMemberRole.editor,
  [WorkspaceMemberRole.viewer]: ProjectMemberRole.viewer,
};

@Injectable()
export class WorkspacePermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    minimumRole: WorkspaceMemberRole,
  ): Promise<WorkspaceMember> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        accessScope: WorkspaceMemberAccessScope.workspace,
        workspace: {
          status: WorkspaceStatus.active,
          deletedAt: null,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: 'WORKSPACE_ACCESS_DENIED',
        msg: 'You do not have access to this workspace.',
      });
    }
    if (
      WORKSPACE_ROLE_RANK[membership.role] < WORKSPACE_ROLE_RANK[minimumRole]
    ) {
      throw new ForbiddenException({
        code: 'WORKSPACE_PERMISSION_DENIED',
        msg: 'You do not have permission to perform this workspace action.',
      });
    }
    return membership;
  }

  /**
   * A roster presence check for workspace shell/navigation. Project-only rows
   * pass this check but do not grant any workspace-wide project permission.
   */
  async requireWorkspacePresence(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMember> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        workspace: {
          status: WorkspaceStatus.active,
          deletedAt: null,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: 'WORKSPACE_ACCESS_DENIED',
        msg: 'You do not have access to this workspace.',
      });
    }
    return membership;
  }

  async requireProjectRole(
    userId: string,
    projectId: string,
    minimumRole: ProjectMemberRole,
  ): Promise<PlatformProject> {
    const project = await this.prisma.platformProject.findFirst({
      where: {
        id: projectId,
        status: PlatformProjectStatus.active,
        deletedAt: null,
      },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        msg: 'Project not found.',
      });
    }

    const projectMember = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
        status: ProjectMemberStatus.active,
        removedAt: null,
      },
    });
    if (
      projectMember &&
      PROJECT_ROLE_RANK[projectMember.role] >= PROJECT_ROLE_RANK[minimumRole]
    ) {
      return project;
    }

    const workspaceMember = await this.requireWorkspaceRole(
      userId,
      project.workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const effectiveRole = WORKSPACE_TO_PROJECT_ROLE[workspaceMember.role];
    if (PROJECT_ROLE_RANK[effectiveRole] < PROJECT_ROLE_RANK[minimumRole]) {
      throw new ForbiddenException({
        code: 'PROJECT_PERMISSION_DENIED',
        msg: 'You do not have permission to perform this project action.',
      });
    }
    return project;
  }

  /**
   * The caller's effective ProjectMemberRole for a project: their direct
   * ProjectMember role if any, else their WorkspaceMember role mapped onto the
   * project ladder (the same fallback `requireProjectRole` grants by). Returns
   * null when the user has neither. Read-only — surfaced to clients so they can
   * gate (e.g. viewer read-only); the server remains the source of truth.
   */
  async resolveEffectiveProjectRole(
    userId: string,
    project: PlatformProject,
  ): Promise<ProjectMemberRole | null> {
    const projectMember = await this.prisma.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId,
        status: ProjectMemberStatus.active,
        removedAt: null,
      },
    });
    if (projectMember) return projectMember.role;

    const workspaceMember = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId: project.workspaceId,
        userId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        accessScope: WorkspaceMemberAccessScope.workspace,
        workspace: { status: WorkspaceStatus.active, deletedAt: null },
      },
    });
    if (!workspaceMember) return null;
    return WORKSPACE_TO_PROJECT_ROLE[workspaceMember.role];
  }
}
