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

  async link(crewId: string, userId: string, workspaceId: string | null) {
    await this.requireAdmin(crewId, userId);
    try {
      return await this.prisma.$transaction(async (tx) => {
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
