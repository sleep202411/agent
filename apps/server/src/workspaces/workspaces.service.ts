import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CharacterGrantService } from '../characters/character-grant.service';
import {
  BillingOrderStatus,
  BillingSubjectType,
  BillingSubscriptionStatus,
  StudioDocumentStatus,
  StudioDocumentType,
  PlatformProjectStatus,
  ProjectMemberRole,
  ProjectMemberStatus,
  ProjectVisibility,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletOwnerType,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  type PlatformProject,
  type Workspace,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from './audit-log.service';
import type {
  ArchiveProjectInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  UpdateProjectInput,
  UpdateWorkspaceInput,
} from './dto';
import { WalletLedgerService } from './wallet-ledger.service';
import {
  WorkspacePermissionService,
  type WorkspaceAccess,
} from './workspace-permission.service';
import { enqueueProjectChanged } from './project-realtime';
import { RealtimeRevokeService } from '../infra/realtime/realtime-revoke.service';
import { createProjectSectionWithCanvas } from '../project-sections/project-section.persistence';
import { lockMediaAssetReference } from '../media/media-asset-lifecycle-lock';

type ProjectWithCanvasPreview = PlatformProject & {
  documents?: Array<{ contentSnapshot: unknown }>;
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletLedgerService,
    private readonly audit: PlatformAuditLogService,
    private readonly permissions: WorkspacePermissionService,
    private readonly realtimeRevoke: RealtimeRevokeService,
    private readonly moduleRef: ModuleRef,
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

    const linked = await this.prisma.crew.findMany({
      where: {
        deletedAt: null,
        studioWorkspace: { status: 'active', deletedAt: null },
        members: { some: { userId: user.userId, status: 'active' } },
      },
      select: { studioWorkspace: true },
    });
    const rows = new Map(
      memberships.map((member) => [
        member.workspaceId,
        this.workspaceDto(member.workspace, user.userId, member),
      ]),
    );
    for (const crew of linked) {
      if (!crew.studioWorkspace) continue;
      try {
        const access = await this.permissions.requireWorkspacePresence(
          user.userId,
          crew.studioWorkspace.id,
        );
        rows.set(
          crew.studioWorkspace.id,
          this.workspaceDto(crew.studioWorkspace, user.userId, access),
        );
      } catch (error) {
        // A grant may be denied explicitly or removed between the two reads.
        // It must not hide the user's independently accessible workspaces.
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return { workspaces: [...rows.values()] };
  }

  async ensureAndReturnDefaultWorkspace(user: AuthUser) {
    const workspace = await this.ensureDefaultWorkspace(user);
    return { workspace: this.workspaceDto(workspace, user.userId) };
  }

  async ensureDefaultWorkspace(user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`workspace:default:${user.userId}`})::bigint)
      `;

      let workspace = await tx.workspace.findFirst({
        where: {
          defaultForUserId: user.userId,
          deletedAt: null,
        },
      });

      if (!workspace) {
        workspace = await tx.workspace.create({
          data: {
            defaultForUserId: user.userId,
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
            },
          });
        }
      }

      await this.wallets.ensureDefaultAccounts(
        WalletOwnerType.user,
        user.userId,
        tx,
      );
      await this.wallets.ensureDefaultAccounts(
        WalletOwnerType.workspace,
        workspace.id,
        tx,
      );
      return workspace;
    });
  }

  async createWorkspace(user: AuthUser, input: CreateWorkspaceInput) {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
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
        },
      });
      await this.wallets.ensureDefaultAccounts(
        WalletOwnerType.workspace,
        created.id,
        tx,
      );
      await this.audit.record(
        {
          workspaceId: created.id,
          actorUserId: user.userId,
          action: 'workspace.created',
          entityType: 'workspace',
          entityId: created.id,
          after: created,
        },
        tx,
      );
      return created;
    });

    return { workspace: this.workspaceDto(workspace, user.userId) };
  }

  async getWorkspace(user: AuthUser, workspaceId: string) {
    const membership = await this.permissions.requireWorkspacePresence(
      user.userId,
      workspaceId,
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
    return { workspace: this.workspaceDto(workspace, user.userId, membership) };
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
    const workspace = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.admin,
        tx,
      );
      const before = await tx.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
      });
      if (!before) {
        throw new NotFoundException({
          code: 'WORKSPACE_NOT_FOUND',
          msg: 'Workspace not found.',
        });
      }

      const result = await tx.workspace.updateMany({
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
          avatarUrl:
            input.avatarUrl === undefined ? undefined : input.avatarUrl,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'WORKSPACE_VERSION_CONFLICT',
          msg: 'Workspace was modified by another request.',
        });
      }

      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: user.userId,
          action: 'workspace.updated',
          entityType: 'workspace',
          entityId: workspaceId,
          before,
          after: workspace,
        },
        tx,
      );
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.admin,
        tx,
      );
      return workspace;
    });

    return { workspace: this.workspaceDto(workspace, user.userId) };
  }

  async listProjects(user: AuthUser, workspaceId: string) {
    const membership = await this.permissions.requireWorkspacePresence(
      user.userId,
      workspaceId,
    );
    const projects = await this.prisma.platformProject.findMany({
      where: {
        deletedAt: null,
        status: PlatformProjectStatus.active,
        workspaceId,
        ...(membership.accessScope === 'project_only'
          ? {
              members: {
                some: {
                  userId: user.userId,
                  status: ProjectMemberStatus.active,
                  removedAt: null,
                },
              },
            }
          : {}),
      },
      include: {
        documents: {
          where: {
            type: StudioDocumentType.canvas,
            status: StudioDocumentStatus.active,
            deletedAt: null,
          },
          orderBy: [{ createdAt: 'asc' }],
          take: 1,
          select: { contentSnapshot: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const rows = await Promise.all(
      projects.map(async (project) =>
        this.projectDto(
          project,
          await this.permissions.resolveEffectiveProjectRole(
            user.userId,
            project,
          ),
        ),
      ),
    );
    return { projects: rows };
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
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.editor,
        tx,
      );
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
      await createProjectSectionWithCanvas(tx, {
        workspaceId,
        projectId: created.id,
        title: input.initialSectionTitle,
        rank: 0,
        actorId: user.userId,
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
      await this.audit.record(
        {
          workspaceId,
          projectId: created.id,
          actorUserId: user.userId,
          action: 'project.created',
          entityType: 'project',
          entityId: created.id,
          after: created,
        },
        tx,
      );
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.editor,
        tx,
      );
      return created;
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
    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const project = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const before = await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      // A cover must be a ready image asset inside the project's own
      // workspace — binding a foreign/broken asset would 404 the thumbnail.
      if (input.coverAssetId != null) {
        await lockMediaAssetReference(tx, input.coverAssetId);
        const coverAsset = await tx.mediaAsset.findFirst({
          where: {
            id: input.coverAssetId,
            workspaceId: before.workspaceId,
            kind: 'image',
            status: 'ready',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!coverAsset) {
          throw new BadRequestException({
            code: 'PROJECT_COVER_ASSET_INVALID',
            msg: 'Cover asset must be a ready image in this workspace.',
          });
        }
      }
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
          coverAssetId:
            input.coverAssetId === undefined ? undefined : input.coverAssetId,
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
      await this.audit.record(
        {
          workspaceId: updated.workspaceId,
          projectId,
          actorUserId: user.userId,
          action: 'project.updated',
          entityType: 'project',
          entityId: projectId,
          before,
          after: updated,
        },
        tx,
      );
      await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      return updated;
    });

    return { project: this.projectDto(project) };
  }

  async deleteWorkspace(
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
    if (workspace.defaultForUserId !== null) {
      throw new ConflictException({
        code: 'DEFAULT_WORKSPACE_CANNOT_BE_DELETED',
        msg: 'The default workspace cannot be deleted while it receives account credits.',
      });
    }

    // Block deletion while the team still holds money or a live billing
    // relationship. A soft-deleted workspace's compute pot becomes unreadable
    // (every wallet read requires an active workspace) while order fulfillment
    // has no deletedAt guard — so leftover credits, in-flight holds, a charging
    // subscription, or a pending order would strand real money in an
    // unreachable pot. Require the owner to clear these first. Match both the
    // workspaceId FK and the (subjectType, subjectId) subject so no team-scoped
    // record is missed regardless of which the billing path populated.
    const subjectFilter = {
      OR: [
        { workspaceId },
        {
          subjectType: BillingSubjectType.workspace,
          subjectId: workspaceId,
        },
      ],
    };
    const computeAccount = await this.prisma.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: workspaceId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      select: { id: true },
    });
    if (computeAccount) {
      // Sweep lapsed grants first so worthless expired credits don't over-block.
      await this.wallets
        .expireLapsedGrants(computeAccount.id)
        .catch(() => undefined);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.owner,
        tx,
      );
      const currentWorkspace = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
      });
      if (currentWorkspace.defaultForUserId !== null)
        throw new ConflictException({
          code: 'DEFAULT_WORKSPACE_CANNOT_BE_DELETED',
          msg: 'The default workspace cannot be deleted while it receives account credits.',
        });
      const currentAccount = await tx.walletAccount.findUnique({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: WalletOwnerType.workspace,
            ownerId: workspaceId,
            currency: WalletCurrencyType.compute_point,
            balanceKind: WalletBalanceKind.consumable,
          },
        },
        select: { id: true },
      });

      if (currentAccount)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${currentAccount.id}`})::bigint)`;
      const freshAccount = currentAccount
        ? await tx.walletAccount.findUnique({
            where: { id: currentAccount.id },
            select: { availableBalance: true, heldBalance: true },
          })
        : null;
      const activeSubscriptions = await tx.billingSubscription.count({
        where: {
          status: {
            in: [
              BillingSubscriptionStatus.active,
              BillingSubscriptionStatus.past_due,
            ],
          },
          ...subjectFilter,
        },
      });
      const pendingOrders = await tx.billingOrder.count({
        where: { status: BillingOrderStatus.pending_payment, ...subjectFilter },
      });
      const available = freshAccount?.availableBalance ?? 0n;
      const held = freshAccount?.heldBalance ?? 0n;
      const blockers: Array<{ type: string; detail: string }> = [];
      if (available > 0n) {
        blockers.push({
          type: 'compute_balance',
          detail: `${available} compute credits remaining`,
        });
      }
      if (held > 0n) {
        blockers.push({
          type: 'compute_hold',
          detail: `${held} compute credits held by in-progress generations`,
        });
      }
      if (activeSubscriptions > 0) {
        blockers.push({
          type: 'active_subscription',
          detail: `${activeSubscriptions} active plan${activeSubscriptions === 1 ? '' : 's'}`,
        });
      }
      if (pendingOrders > 0) {
        blockers.push({
          type: 'pending_order',
          detail: `${pendingOrders} unpaid order${pendingOrders === 1 ? '' : 's'}`,
        });
      }
      if (blockers.length > 0) {
        throw new ConflictException({
          code: 'WORKSPACE_NOT_EMPTY',
          msg: `This workspace still has ${blockers
            .map((blocker) => blocker.detail)
            .join(
              '; ',
            )}. Spend down the remaining credits (or ask support to adjust the balance), let in-progress generations finish, cancel any active plan, and settle pending orders before deleting.`,
          blockers,
        });
      }

      await this.audit.record(
        {
          workspaceId,
          actorUserId: user.userId,
          action: 'workspace.deleted',
          entityType: 'workspace',
          entityId: workspaceId,
          before: currentWorkspace,
        },
        tx,
      );
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.owner,
        tx,
      );
      const result = await tx.workspace.updateMany({
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
    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.owner,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const before = await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.owner,
        tx,
      );
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
      await this.audit.record(
        {
          workspaceId: before.workspaceId,
          projectId,
          actorUserId: user.userId,
          action: 'project.archived',
          entityType: 'project',
          entityId: projectId,
          before,
        },
        tx,
      );
      await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.owner,
        tx,
      );
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

      if (updated.count === 0)
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          msg: 'Project was modified by another request.',
        });
      return updated;
    });

    // ⟦v2⟧ Archiving tears down every real_person likeness grant for this
    // project — a scoped revocation ledger entry per grant + in-flight job
    // cancel (design v2 §5/§7). Resolved lazily via ModuleRef because
    // CharactersModule imports WorkspacesModule (importing it here would
    // cycle); strict:false scans the whole container. Best-effort.
    try {
      const grants = this.moduleRef.get(CharacterGrantService, {
        strict: false,
      });
      await grants.revokeGrantsForProject(projectId, 'project_archived');
    } catch {
      /* likeness teardown is best-effort; never blocks the archive */
    }

    return { archived: true, projectId };
  }

  private workspaceDto(
    workspace: Workspace,
    userId: string,
    membership?: WorkspaceAccess,
  ) {
    return {
      id: workspace.id,
      isDefault: workspace.defaultForUserId === userId,
      status: workspace.status,
      name: workspace.name,
      slug: workspace.slug,
      avatarUrl: workspace.avatarUrl,
      description: workspace.description,
      ownerUserId: workspace.ownerUserId,
      defaultProjectId: workspace.defaultProjectId,
      role: membership?.role,
      accessScope: membership?.accessScope,
      crewRole: membership?.crewRole,
      version: workspace.version,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
    };
  }

  private projectDto(
    project: ProjectWithCanvasPreview,
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
      thumbnailUrl: project.coverAssetId
        ? mediaAssetContentUrl(project.coverAssetId)
        : earliestCanvasImageAssetUrl(project.documents?.[0]?.contentSnapshot),
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

function mediaAssetContentUrl(assetId: string): string {
  return `/aurora/media/assets/${encodeURIComponent(assetId)}/content`;
}

function earliestCanvasImageAssetUrl(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null;
  const assets = snapshot.assets;
  const values = Array.isArray(assets)
    ? assets
    : isRecord(assets)
      ? Object.values(assets)
      : [];
  const images = values
    .filter(isRecord)
    .filter((asset) => asset.kind === 'image' && typeof asset.url === 'string')
    .sort((a, b) => assetCreatedAt(a) - assetCreatedAt(b));
  const first = images[0];
  return typeof first?.url === 'string' ? first.url : null;
}

function assetCreatedAt(asset: Record<string, unknown>): number {
  const value = asset.createdAt;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function displayName(user: AuthUser): string {
  return user.nickName?.trim() || user.userName?.trim() || 'My';
}
