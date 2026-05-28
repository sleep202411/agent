import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformDocumentStatus,
  PlatformProjectStatus,
  ProjectMemberRole,
  ProjectMemberStatus,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
  type PlatformDocument,
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

    const requiredWorkspaceRole =
      minimumRole === ProjectMemberRole.viewer
        ? WorkspaceMemberRole.viewer
        : minimumRole === ProjectMemberRole.editor
          ? WorkspaceMemberRole.editor
          : WorkspaceMemberRole.admin;
    await this.requireWorkspaceRole(
      userId,
      project.workspaceId,
      requiredWorkspaceRole,
    );
    return project;
  }

  async requireDocumentRole(
    userId: string,
    documentId: string,
    minimumRole: ProjectMemberRole,
  ): Promise<PlatformDocument> {
    const document = await this.prisma.platformDocument.findFirst({
      where: {
        id: documentId,
        status: PlatformDocumentStatus.active,
        deletedAt: null,
        project: {
          status: PlatformProjectStatus.active,
          deletedAt: null,
        },
      },
    });
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        msg: 'Document not found.',
      });
    }
    await this.requireProjectRole(userId, document.projectId, minimumRole);
    return document;
  }
}
