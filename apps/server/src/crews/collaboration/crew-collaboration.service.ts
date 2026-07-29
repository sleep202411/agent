import { Injectable } from '@nestjs/common';
import {
  PlatformDocumentStatus,
  PlatformDocumentType,
  PlatformDocumentVersionSource,
  PlatformProjectStatus,
  Prisma,
  ProjectMemberRole,
  ProjectMemberStatus,
  ProjectVisibility,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
  WorkspaceType,
  WalletOwnerType,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { WalletLedgerService } from '../../workspaces';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CrewCollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletLedgerService,
  ) {}

  /**
   * Idempotently provisions the collaboration backbone for a crew. The main
   * project is the shared production trunk; each CrewTask gets its own project
   * and canvas copied from the trunk's current materialized state.
   */
  async ensureCrewSpace(crewId: string) {
    const space = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:collaboration:${crewId}`})::bigint)
      `;
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
    });

    let workspaceId = crew.workspaceId;
    if (!workspaceId) {
      const workspace = await tx.workspace.create({
        data: {
          type: WorkspaceType.team,
          status: WorkspaceStatus.active,
          name: crew.name,
          avatarUrl: crew.logo,
          description: crew.description,
          ownerUserId: crew.founderId,
          createdById: crew.founderId,
        },
      });
      workspaceId = workspace.id;
    }

    await this.upsertWorkspaceMember(
      workspaceId,
      crew.founderId,
      WorkspaceMemberRole.owner,
      crew.founderId,
      tx,
    );
    const members = await tx.crewMember.findMany({
      where: { crewId, removedAt: null, userId: { not: crew.founderId } },
      select: { userId: true },
    });
    for (const member of members) {
      await this.upsertWorkspaceMember(
        workspaceId,
        member.userId,
        WorkspaceMemberRole.viewer,
        crew.founderId,
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
          createdById: crew.founderId,
        },
      });
      productionProjectId = project.id;
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: crew.founderId,
          role: ProjectMemberRole.owner,
          status: ProjectMemberStatus.active,
          grantedById: crew.founderId,
        },
      });
      const document = await tx.platformDocument.create({
        data: {
          workspaceId,
          projectId: project.id,
          type: PlatformDocumentType.canvas,
          status: PlatformDocumentStatus.active,
          title: project.name,
          createdById: crew.founderId,
        },
      });
      const initial = await tx.platformDocumentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          schemaVersion: document.schemaVersion,
          sequence: 0,
          title: document.title,
          source: PlatformDocumentVersionSource.system,
          snapshot: document.contentSnapshot as Prisma.InputJsonValue,
          createdById: crew.founderId,
          metadata: { reason: 'crew_production_created' },
        },
      });
      await tx.platformDocument.update({
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

    const productionDocument = await tx.platformDocument.findFirstOrThrow({
      where: {
        projectId: productionProjectId,
        type: PlatformDocumentType.canvas,
        status: PlatformDocumentStatus.active,
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
  ) {
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true },
    });
    if (!crew?.workspaceId) return;
    await this.upsertWorkspaceMember(
      crew.workspaceId,
      userId,
      WorkspaceMemberRole.viewer,
      grantedById,
      db,
    );
  }

  async removeCrewMemberAccess(
    crewId: string,
    userId: string,
    db: Db = this.prisma,
  ) {
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true },
    });
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
        seatAssigned: false,
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
   * backbone. Crew.founderId is the product authority source of truth, while
   * Workspace/ProjectMember rows are the canvas authorization source of truth;
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
  ) {
    const crew = await db.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true, productionProjectId: true },
    });
    if (!crew?.workspaceId) return;

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
            seatAssigned: false,
          }
        : {
            role: WorkspaceMemberRole.viewer,
            status: WorkspaceMemberStatus.active,
            seatAssigned: true,
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

  private async upsertWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMemberRole,
    invitedById: string,
    db: Db,
  ) {
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
            seatAssigned: true,
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
