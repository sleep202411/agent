import { CrewStudioRevocationService } from './crew-studio-revocation.service';
import { createCrewStudioWorkspaceTx } from './create-studio-workspace';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

/** Workspaces the user can bind to a Crew: owner field or owner/admin membership. */
export function workspaceLinkableWhere(
  userId: string,
  crewId?: string,
): Prisma.WorkspaceWhereInput {
  return {
    deletedAt: null,
    status: 'active',
    AND: [
      {
        OR: [
          { ownerUserId: userId },
          {
            members: {
              some: {
                userId,
                role: {
                  in: [WorkspaceMemberRole.owner, WorkspaceMemberRole.admin],
                },
                status: WorkspaceMemberStatus.active,
                removedAt: null,
              },
            },
          },
        ],
      },
      crewId
        ? { OR: [{ studioCrew: null }, { studioCrew: { id: crewId } }] }
        : { studioCrew: null },
    ],
  };
}

@Injectable()
export class CrewStudioWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly studioRevocation: CrewStudioRevocationService,
  ) {}

  private async requireAdmin(
    crewId: string,
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const context = await this.authorization.require(
      crewId,
      userId,
      'production.manage',
      db,
    );
    if (!context.isOwner && !context.policyKeys.includes('admin')) {
      throw new ForbiddenException(
        'Only a Crew administrator can link a Studio workspace.',
      );
    }
  }

  async optionsForCreate(userId: string) {
    return this.prisma.workspace.findMany({
      where: workspaceLinkableWhere(userId),
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async options(crewId: string, userId: string) {
    await this.requireAdmin(crewId, userId);
    return this.prisma.workspace.findMany({
      where: workspaceLinkableWhere(userId, crewId),
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /** Repair missing setup on an existing Crew without replacing an existing link. */
  async initialize(crewId: string, userId: string) {
    await this.requireAdmin(crewId, userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:studio-workspace:${crewId}`})::bigint)`;
      await this.requireAdmin(crewId, userId, tx);
      const crew = await tx.crew.findUniqueOrThrow({
        where: { id: crewId, deletedAt: null },
        select: { name: true, studioWorkspaceId: true, studioProjectId: true },
      });
      if (crew.studioWorkspaceId) {
        const workspace = await tx.workspace.findFirst({
          where: {
            id: crew.studioWorkspaceId,
            deletedAt: null,
            status: 'active',
          },
          select: { id: true, name: true },
        });
        if (!workspace)
          throw new ConflictException(
            'The linked workspace is unavailable. Review its link before initializing.',
          );
        return { studioWorkspace: workspace, created: false };
      }
      if (crew.studioProjectId) {
        throw new ConflictException(
          'This Crew has a legacy Studio project. Select its workspace explicitly before initializing.',
        );
      }
      const workspace = await createCrewStudioWorkspaceTx(
        tx,
        userId,
        crew.name,
      );
      await tx.crew.update({
        where: { id: crewId },
        data: { studioWorkspaceId: workspace.id },
      });
      await tx.crewProductionActivity.create({
        data: {
          crewId,
          kind: 'properties_changed',
          createdByUserId: userId,
          payload: {
            changes: [
              { field: 'studio_workspace_id', from: null, to: workspace.id },
            ],
          },
        },
      });
      await this.requireAdmin(crewId, userId, tx);
      return { studioWorkspace: workspace, created: true };
    });
  }

  async link(crewId: string, userId: string, workspaceId: string | null) {
    await this.requireAdmin(crewId, userId);
    let revokedWorkspaceId: string | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:studio-workspace:${crewId}`})::bigint)`;
        await this.requireAdmin(crewId, userId, tx);
        // Serialize ownership transfer and competing links before checking ownership.
        if (workspaceId) {
          await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
        }
        const workspace = workspaceId
          ? await tx.workspace.findFirst({
              where: {
                id: workspaceId,
                ...workspaceLinkableWhere(userId, crewId),
              },
              select: { id: true, name: true },
            })
          : null;
        if (workspaceId && !workspace)
          throw new NotFoundException('Workspace not found.');
        const crew = await tx.crew.findUniqueOrThrow({
          where: { id: crewId },
          select: { studioWorkspaceId: true, studioProjectId: true },
        });
        await tx.crew.update({
          where: { id: crewId },
          data: { studioWorkspaceId: workspaceId, studioProjectId: null },
        });
        if (crew.studioWorkspaceId !== workspaceId)
          revokedWorkspaceId = crew.studioWorkspaceId;
        if (crew.studioWorkspaceId !== workspaceId || crew.studioProjectId) {
          await tx.crewProductionActivity.create({
            data: {
              crewId,
              kind: 'properties_changed',
              createdByUserId: userId,
              payload: {
                changes: [
                  ...(crew.studioProjectId
                    ? [
                        {
                          field: 'studio_project_id',
                          from: crew.studioProjectId,
                          to: null,
                        },
                      ]
                    : []),
                  {
                    field: 'studio_workspace_id',
                    from: crew.studioWorkspaceId,
                    to: workspaceId,
                  },
                ],
              },
            },
          });
        }
        await this.requireAdmin(crewId, userId, tx);
        return {
          studioWorkspace: workspace
            ? { id: workspace.id, name: workspace.name }
            : null,
        };
      });
      if (revokedWorkspaceId)
        await this.studioRevocation.revoke(crewId, revokedWorkspaceId);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'This workspace is already linked to another Crew.',
        );
      throw error;
    }
  }
}
