import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  PlatformProjectStatus,
  Prisma,
  ProjectMemberRole,
  ProjectMemberStatus,
  ProjectVisibility,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
  WalletOwnerType,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { encodeDocumentSnapshot } from '../../documents/document-crdt';
import { rootSchemaFor } from '../../documents/document-modes';
import { WalletLedgerService } from '../../workspaces';
import {
  CrewAuthorizationService,
  type CrewAuthorizationContext,
} from '../crew-authorization.service';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CrewCollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletLedgerService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  /**
   * Idempotently provisions the collaboration backbone for a crew. The main
   * project is the shared production trunk; each CrewTask gets its own project
   * and canvas copied from the trunk's current materialized state.
   */
  async ensureCrewSpace(crewId: string, requestingOwnerId?: string) {
    const space = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:collaboration:${crewId}`})::bigint)
      `;
      if (requestingOwnerId) {
        await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
        const access = await this.authorization.resolve(
          crewId,
          requestingOwnerId,
          tx,
        );
        if (!access?.isOwner)
          throw new ForbiddenException(
            'Only the project owner can set up compute',
          );
      }
      return this.ensureCrewSpaceTx(crewId, tx);
    });
    await this.wallets.ensureDefaultAccounts(
      WalletOwnerType.workspace,
      space.workspaceId,
    );
    return space;
  }

  async ensureCrewSpaceTx(crewId: string, tx: Prisma.TransactionClient) {
    const crew = await tx.crew.findFirstOrThrow({
      where: { id: crewId, deletedAt: null },
      include: {
        ownership: { include: { member: { select: { userId: true } } } },
      },
    });
    if (!crew.ownership) throw new Error(`Crew ${crewId} has no owner`);
    const ownerUserId = crew.ownership.member.userId;

    let workspaceId = crew.workspaceId;
    if (!workspaceId) {
      const workspace = await tx.workspace.create({
        data: {
          status: WorkspaceStatus.active,
          name: crew.name,
          avatarUrl: crew.logo,
          description: crew.description,
          ownerUserId,
          createdById: ownerUserId,
        },
      });
      workspaceId = workspace.id;
    }

    await this.upsertWorkspaceMember(
      workspaceId,
      ownerUserId,
      WorkspaceMemberRole.owner,
      ownerUserId,
      tx,
    );
    const members = await tx.crewMember.findMany({
      where: {
        crewId,
        status: 'active',
        userId: { not: ownerUserId },
      },
      select: { userId: true },
    });
    for (const member of members) {
      const context = await this.authorization.requireMembership(
        crewId,
        member.userId,
        tx,
      );
      await this.upsertWorkspaceMember(
        workspaceId,
        member.userId,
        workspaceRoleFor(context),
        ownerUserId,
        tx,
      );
    }

    let productionProjectId = crew.productionProjectId;
    if (!productionProjectId) {
      const project = await tx.platformProject.create({
        data: {
          workspaceId,
          name: `${crew.name} Production`,
          projectType: 'crew_production',
          status: PlatformProjectStatus.active,
          visibility: ProjectVisibility.workspace,
          description: 'Main production canvas for this crew.',
          createdById: ownerUserId,
        },
      });
      productionProjectId = project.id;
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: ownerUserId,
          role: ProjectMemberRole.owner,
          status: ProjectMemberStatus.active,
          grantedById: ownerUserId,
        },
      });
      const initialCanvasState = encodeDocumentSnapshot(
        {},
        rootSchemaFor(StudioDocumentType.canvas)!,
      );
      const document = await tx.studioDocument.create({
        data: {
          workspaceId,
          platformProjectId: project.id,
          type: StudioDocumentType.canvas,
          status: StudioDocumentStatus.active,
          title: project.name,
          contentSnapshot:
            initialCanvasState.snapshot as unknown as Prisma.InputJsonValue,
          crdtState: Buffer.from(initialCanvasState.state),
          createdById: ownerUserId,
        },
      });
      const initial = await tx.studioDocumentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          schemaVersion: document.schemaVersion,
          sequence: 0,
          title: document.title,
          source: StudioDocumentVersionSource.system,
          snapshot: document.contentSnapshot as Prisma.InputJsonValue,
          crdtState: document.crdtState,
          createdById: ownerUserId,
          metadata: { reason: 'crew_production_created' },
        },
      });
      await tx.studioDocument.update({
        where: { id: document.id },
        data: { currentVersionId: initial.id },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { defaultProjectId: project.id },
      });
    }

    if (
      crew.workspaceId !== workspaceId ||
      crew.productionProjectId !== productionProjectId
    ) {
      await tx.crew.update({
        where: { id: crew.id },
        data: { workspaceId, productionProjectId },
      });
    }

    const productionDocument = await tx.studioDocument.findFirstOrThrow({
      where: {
        platformProjectId: productionProjectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    return { crew, workspaceId, productionProjectId, productionDocument };
  }

  async addCrewMemberAccess(
    crewId: string,
    userId: string,
    grantedById: string,
    db: Db = this.prisma,
  ): Promise<void> {
    if (db === this.prisma)
      return this.prisma.$transaction((tx) =>
        this.addCrewMemberAccess(crewId, userId, grantedById, tx),
      );
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true },
    });
    if (!crew?.workspaceId) return;
    const context = await this.authorization.requireMembership(
      crewId,
      userId,
      db,
    );
    await this.upsertWorkspaceMember(
      crew.workspaceId,
      userId,
      workspaceRoleFor(context),
      grantedById,
      db,
    );
  }

  async removeCrewMemberAccess(
    crewId: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<void> {
    if (db === this.prisma)
      return this.prisma.$transaction((tx) =>
        this.removeCrewMemberAccess(crewId, userId, tx),
      );
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true },
    });
    if (crew?.workspaceId)
      await this.lockWorkspaceProjects(db, crew.workspaceId);
    await db.crewAssetGrant.deleteMany({
      where: { userId, node: { crewId } },
    });
    if (!crew?.workspaceId) return;
    const now = new Date();
    await db.workspaceMember.updateMany({
      where: { workspaceId: crew.workspaceId, userId, removedAt: null },
      data: {
        status: WorkspaceMemberStatus.removed,
        removedAt: now,
      },
    });
    await db.projectMember.updateMany({
      where: {
        userId,
        removedAt: null,
        project: { workspaceId: crew.workspaceId },
      },
      data: { status: ProjectMemberStatus.removed, removedAt: now },
    });
  }

  /**
   * Atomically projects a crew ownership transfer into the collaboration
   * backbone. CrewOwnership is the product authority source of truth, while
   * Workspace/ProjectMember rows are technical authorization projections;
   * letting either side move without the other would leave a former owner with
   * elevated Studio access or lock the new owner out.
   *
   * Task-canvas project ownership is intentionally left with the task creator
   * when they remain a crew member. The incoming workspace owner already has
   * owner-level authority over every workspace project. If the outgoing owner
   * leaves the crew, all of their direct project memberships are revoked.
   */
  async transferCrewOwnershipAccess(
    crewId: string,
    outgoingOwnerId: string,
    incomingOwnerId: string,
    removeOutgoingOwner: boolean,
    db: Db = this.prisma,
  ): Promise<void> {
    if (db === this.prisma)
      return this.prisma.$transaction((tx) =>
        this.transferCrewOwnershipAccess(
          crewId,
          outgoingOwnerId,
          incomingOwnerId,
          removeOutgoingOwner,
          tx,
        ),
      );
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true, productionProjectId: true },
    });
    if (!crew?.workspaceId) return;

    await this.lockWorkspaceProjects(db, crew.workspaceId);
    const now = new Date();
    await db.workspace.update({
      where: { id: crew.workspaceId },
      data: {
        ownerUserId: incomingOwnerId,
        version: { increment: 1 },
      },
    });

    await db.workspaceMember.updateMany({
      where: {
        workspaceId: crew.workspaceId,
        userId: outgoingOwnerId,
        removedAt: null,
      },
      data: removeOutgoingOwner
        ? {
            role: WorkspaceMemberRole.viewer,
            status: WorkspaceMemberStatus.removed,
            removedAt: now,
          }
        : {
            role: WorkspaceMemberRole.viewer,
            status: WorkspaceMemberStatus.active,
          },
    });
    await this.upsertWorkspaceMember(
      crew.workspaceId,
      incomingOwnerId,
      WorkspaceMemberRole.owner,
      incomingOwnerId,
      db,
    );

    if (removeOutgoingOwner) {
      await db.crewAssetGrant.deleteMany({
        where: { userId: outgoingOwnerId, node: { crewId } },
      });
      await db.projectMember.updateMany({
        where: {
          userId: outgoingOwnerId,
          removedAt: null,
          project: { workspaceId: crew.workspaceId },
        },
        data: {
          status: ProjectMemberStatus.removed,
          removedAt: now,
        },
      });
    } else if (crew.productionProjectId) {
      await db.projectMember.updateMany({
        where: {
          projectId: crew.productionProjectId,
          userId: outgoingOwnerId,
          removedAt: null,
          role: ProjectMemberRole.owner,
        },
        data: {
          role: ProjectMemberRole.viewer,
          status: ProjectMemberStatus.active,
        },
      });
    }

    if (crew.productionProjectId) {
      await this.upsertProjectMember(
        crew.productionProjectId,
        incomingOwnerId,
        ProjectMemberRole.owner,
        incomingOwnerId,
        db,
      );
    }
  }

  /** Serialize authorization projections with document/project writers. */
  private async lockWorkspaceProjects(db: Db, workspaceId: string) {
    await db.$queryRaw`SELECT id FROM platform_projects WHERE workspace_id = ${workspaceId}::uuid ORDER BY id FOR UPDATE`;
  }

  private async upsertWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMemberRole,
    invitedById: string,
    db: Db,
  ) {
    await this.lockWorkspaceProjects(db, workspaceId);
    const current = await db.workspaceMember.findFirst({
      where: { workspaceId, userId, removedAt: null },
    });
    if (current) {
      if (
        current.role !== role ||
        current.status !== WorkspaceMemberStatus.active
      ) {
        await db.workspaceMember.update({
          where: { id: current.id },
          data: {
            role,
            status: WorkspaceMemberStatus.active,
          },
        });
      }
      return;
    }
    await db.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role,
        status: WorkspaceMemberStatus.active,
        invitedById,
        joinedAt: new Date(),
      },
    });
  }

  private async upsertProjectMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole,
    grantedById: string,
    db: Db,
  ) {
    const current = await db.projectMember.findFirst({
      where: { projectId, userId, removedAt: null },
    });
    if (current) {
      if (
        current.role !== role ||
        current.status !== ProjectMemberStatus.active
      ) {
        await db.projectMember.update({
          where: { id: current.id },
          data: {
            role,
            status: ProjectMemberStatus.active,
          },
        });
      }
      return;
    }
    await db.projectMember.create({
      data: {
        projectId,
        userId,
        role,
        status: ProjectMemberStatus.active,
        grantedById,
      },
    });
  }
}

function workspaceRoleFor(
  context: CrewAuthorizationContext,
): WorkspaceMemberRole {
  if (context.isOwner) return WorkspaceMemberRole.owner;
  if (context.policyKeys.includes('admin')) return WorkspaceMemberRole.admin;
  if (context.permissions.includes('studio.edit')) {
    return WorkspaceMemberRole.editor;
  }
  return WorkspaceMemberRole.viewer;
}
