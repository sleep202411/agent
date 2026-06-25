import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformProjectStatus,
  ProjectMemberRole,
  ProjectVisibility,
  WalletOwnerType,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceType,
  type PlatformProject,
  type Workspace,
  type WorkspaceMember,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from './audit-log.service';
import type {
  ArchiveProjectInput,
  CreateProjectInput,
  CreateTeamWorkspaceInput,
  DeleteWorkspaceInput,
  UpdateProjectInput,
  UpdateWorkspaceInput,
} from './dto';
import { WalletLedgerService } from './wallet-ledger.service';
import { WorkspacePermissionService } from './workspace-permission.service';
import { enqueueProjectChanged } from './project-realtime';
import { RealtimeRevokeService } from '../infra/realtime/realtime-revoke.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletLedgerService,
    private readonly audit: PlatformAuditLogService,
    private readonly permissions: WorkspacePermissionService,
    private readonly realtimeRevoke: RealtimeRevokeService,
  ) {}

  async listForUser(user: AuthUser) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId: user.userId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        workspace: { deletedAt: null },
      },
      include: { workspace: true },
      orderBy: [{ joinedAt: 'asc' }],
    });

    return {
      workspaces: memberships.map((membership) =>
        this.workspaceDto(membership.workspace, membership),
      ),
    };
  }

  async ensureAndReturnPersonalWorkspace(user: AuthUser) {
    const workspace = await this.ensurePersonalWorkspace(user);
    return { workspace: this.workspaceDto(workspace) };
  }

  async ensurePersonalWorkspace(user: AuthUser) {
    return this.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`workspace:personal:${user.userId}`})::bigint)
      `;

        let workspace = await tx.workspace.findFirst({
          where: {
            type: WorkspaceType.personal,
            ownerUserId: user.userId,
            deletedAt: null,
          },
        });

        if (!workspace) {
          workspace = await tx.workspace.create({
            data: {
              type: WorkspaceType.personal,
              name: `${displayName(user)}'s Workspace`,
              ownerUserId: user.userId,
              createdById: user.userId,
            },
          });
          await tx.workspaceMember.create({
            data: {
              workspaceId: workspace.id,
              userId: user.userId,
              role: WorkspaceMemberRole.owner,
              status: WorkspaceMemberStatus.active,
              seatAssigned: true,
            },
          });
        } else {
          const member = await tx.workspaceMember.findFirst({
            where: {
              workspaceId: workspace.id,
              userId: user.userId,
              removedAt: null,
            },
          });
          if (!member) {
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: user.userId,
                role: WorkspaceMemberRole.owner,
                status: WorkspaceMemberStatus.active,
                seatAssigned: true,
              },
            });
          }
        }

        return workspace;
      })
      .then(async (workspace) => {
        await this.wallets.ensureDefaultAccounts(
          WalletOwnerType.user,
          user.userId,
        );
        await this.wallets.ensureDefaultAccounts(
          WalletOwnerType.workspace,
          workspace.id,
        );
        return workspace;
      });
  }

  async createTeamWorkspace(user: AuthUser, input: CreateTeamWorkspaceInput) {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          type: WorkspaceType.team,
          name: input.name,
          slug: input.slug,
          description: input.description,
          avatarUrl: input.avatarUrl,
          ownerUserId: user.userId,
          createdById: user.userId,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: created.id,
          userId: user.userId,
          role: WorkspaceMemberRole.owner,
          status: WorkspaceMemberStatus.active,
          seatAssigned: true,
        },
      });
      return created;
    });

    await this.wallets.ensureDefaultAccounts(
      WalletOwnerType.workspace,
      workspace.id,
    );
    await this.audit.record({
      workspaceId: workspace.id,
      actorUserId: user.userId,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: workspace.id,
      after: workspace,
    });

    return { workspace: this.workspaceDto(workspace) };
  }

  async getWorkspace(user: AuthUser, workspaceId: string) {
    const membership = await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!workspace) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    return { workspace: this.workspaceDto(workspace, membership) };
  }

  async updateWorkspace(
    user: AuthUser,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ) {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );
    const before = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!before) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    if (before.type === WorkspaceType.personal && input.slug !== undefined) {
      throw new ConflictException({
        code: 'PERSONAL_WORKSPACE_SLUG_LOCKED',
        msg: 'Personal workspace slug cannot be changed.',
      });
    }

    const result = await this.prisma.workspace.updateMany({
      where: {
        id: workspaceId,
        deletedAt: null,
        ...(input.expectedVersion == null
          ? {}
          : { version: input.expectedVersion }),
      },
      data: {
        name: input.name,
        slug: input.slug === null ? null : input.slug,
        description:
          input.description === undefined ? undefined : input.description,
        avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'WORKSPACE_VERSION_CONFLICT',
        msg: 'Workspace was modified by another request.',
      });
    }

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    await this.audit.record({
      workspaceId,
      actorUserId: user.userId,
      action: 'workspace.updated',
      entityType: 'workspace',
      entityId: workspaceId,
      before,
      after: workspace,
    });

    return { workspace: this.workspaceDto(workspace) };
  }

  async listProjects(user: AuthUser, workspaceId: string) {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const projects = await this.prisma.platformProject.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: PlatformProjectStatus.active,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return { projects: projects.map((project) => this.projectDto(project)) };
  }

  async createProject(
    user: AuthUser,
    workspaceId: string,
    input: CreateProjectInput,
  ) {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.editor,
    );

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformProject.create({
        data: {
          workspaceId,
          name: input.name,
          slug: input.slug,
          projectType: input.projectType,
          visibility: input.visibility as ProjectVisibility,
          description: input.description,
          createdById: user.userId,
        },
      });
      await tx.projectMember.create({
        data: {
          projectId: created.id,
          userId: user.userId,
          role: ProjectMemberRole.owner,
          grantedById: user.userId,
        },
      });
      await tx.workspace.updateMany({
        where: { id: workspaceId, defaultProjectId: null },
        data: { defaultProjectId: created.id },
      });
      await enqueueProjectChanged(tx, {
        workspaceId,
        projectId: created.id,
        action: 'created',
        actorUserId: user.userId,
      });
      return created;
    });

    await this.audit.record({
      workspaceId,
      projectId: project.id,
      actorUserId: user.userId,
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      after: project,
    });

    return { project: this.projectDto(project) };
  }

  async getProject(user: AuthUser, projectId: string) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const role = await this.permissions.resolveEffectiveProjectRole(
      user.userId,
      project,
    );
    return { project: this.projectDto(project, role) };
  }

  async updateProject(
    user: AuthUser,
    projectId: string,
    input: UpdateProjectInput,
  ) {
    const before = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const project = await this.prisma.$transaction(async (tx) => {
      const result = await tx.platformProject.updateMany({
        where: {
          id: projectId,
          deletedAt: null,
          status: PlatformProjectStatus.active,
          ...(input.expectedVersion == null
            ? {}
            : { version: input.expectedVersion }),
        },
        data: {
          name: input.name,
          slug: input.slug === undefined ? undefined : input.slug,
          projectType: input.projectType,
          visibility:
            input.visibility === undefined
              ? undefined
              : (input.visibility as ProjectVisibility),
          description:
            input.description === undefined ? undefined : input.description,
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          msg: 'Project was modified by another request.',
        });
      }
      const updated = await tx.platformProject.findUniqueOrThrow({
        where: { id: projectId },
      });
      // Atomic with the update so the project-list push can't diverge from state.
      await enqueueProjectChanged(tx, {
        workspaceId: updated.workspaceId,
        projectId,
        action: 'updated',
        actorUserId: user.userId,
      });
      return updated;
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: user.userId,
      action: 'project.updated',
      entityType: 'project',
      entityId: projectId,
      before,
      after: project,
    });

    return { project: this.projectDto(project) };
  }

  async deleteTeamWorkspace(
    user: AuthUser,
    workspaceId: string,
    input: DeleteWorkspaceInput,
  ) {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.owner,
    );
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!workspace) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    if (workspace.type === WorkspaceType.personal) {
      throw new ConflictException({
        code: 'PERSONAL_WORKSPACE_CANNOT_BE_DELETED',
        msg: 'Personal workspace cannot be deleted.',
      });
    }
    const result = await this.prisma.workspace.updateMany({
      where: {
        id: workspaceId,
        deletedAt: null,
        ...(input.expectedVersion == null
          ? {}
          : { version: input.expectedVersion }),
      },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'WORKSPACE_VERSION_CONFLICT',
        msg: 'Workspace was modified by another request.',
      });
    }
    await this.audit.record({
      workspaceId,
      actorUserId: user.userId,
      action: 'workspace.deleted',
      entityType: 'workspace',
      entityId: workspaceId,
      before: workspace,
    });
    // Workspace is gone — kick EVERY member's live sockets off its channels now
    // (no userId = all), so nobody keeps a realtime stream to a deleted workspace.
    void this.realtimeRevoke.revokeWorkspaceAccess(workspaceId);
    return { deleted: true, workspaceId };
  }

  async archiveProject(
    user: AuthUser,
    projectId: string,
    input: ArchiveProjectInput,
  ) {
    const before = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.owner,
    );
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformProject.updateMany({
        where: {
          id: projectId,
          deletedAt: null,
          status: PlatformProjectStatus.active,
          ...(input.expectedVersion == null
            ? {}
            : { version: input.expectedVersion }),
        },
        data: {
          status: PlatformProjectStatus.archived,
          archivedAt: new Date(),
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) return null;

      // If this was the workspace's defaultProjectId, clear it so the
      // next created project becomes the new default.
      await tx.workspace.updateMany({
        where: { defaultProjectId: projectId },
        data: { defaultProjectId: null },
      });

      await enqueueProjectChanged(tx, {
        workspaceId: before.workspaceId,
        projectId,
        action: 'archived',
        actorUserId: user.userId,
      });
      return updated;
    });

    if (!result || result.count === 0) {
      throw new ConflictException({
        code: 'PROJECT_VERSION_CONFLICT',
        msg: 'Project was modified by another request.',
      });
    }

    await this.audit.record({
      workspaceId: before.workspaceId,
      projectId,
      actorUserId: user.userId,
      action: 'project.archived',
      entityType: 'project',
      entityId: projectId,
      before,
    });

    return { archived: true, projectId };
  }

  private workspaceDto(workspace: Workspace, membership?: WorkspaceMember) {
    return {
      id: workspace.id,
      type: workspace.type,
      status: workspace.status,
      name: workspace.name,
      slug: workspace.slug,
      avatarUrl: workspace.avatarUrl,
      description: workspace.description,
      ownerUserId: workspace.ownerUserId,
      defaultProjectId: workspace.defaultProjectId,
      role: membership?.role,
      version: workspace.version,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
    };
  }

  private projectDto(
    project: PlatformProject,
    role?: ProjectMemberRole | null,
  ) {
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      slug: project.slug,
      projectType: project.projectType,
      status: project.status,
      visibility: project.visibility,
      description: project.description,
      coverAssetId: project.coverAssetId,
      createdById: project.createdById,
      updatedById: project.updatedById,
      // The caller's effective role (direct project role, else workspace
      // fallback). Lets the client gate edit affordances; server enforces.
      role: role ?? undefined,
      version: project.version,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      archivedAt: project.archivedAt?.toISOString() ?? null,
    };
  }
}

function displayName(user: AuthUser): string {
  return user.nickName?.trim() || user.userName?.trim() || 'Personal';
}
