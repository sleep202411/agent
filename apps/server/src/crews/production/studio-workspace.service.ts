import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

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

  async options(crewId: string, userId: string) {
    await this.requireAdmin(crewId, userId);
    return this.prisma.workspace.findMany({
      where: {
        ownerUserId: userId,
        status: 'active',
        deletedAt: null,
        OR: [{ studioCrew: null }, { studioCrew: { id: crewId } }],
      },
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
              where: { id: workspaceId, deletedAt: null, status: 'active' },
              select: { id: true, name: true, ownerUserId: true },
            })
          : null;
        if (workspaceId && !workspace)
          throw new NotFoundException('Workspace not found.');
        if (workspace && workspace.ownerUserId !== userId)
          throw new ForbiddenException(
            'You must own the Studio workspace to link it.',
          );
        const crew = await tx.crew.findUniqueOrThrow({
          where: { id: crewId },
          select: { studioWorkspaceId: true },
        });
        await tx.crew.update({
          where: { id: crewId },
          data: { studioWorkspaceId: workspaceId, studioProjectId: null },
        });
        if (crew.studioWorkspaceId !== workspaceId) {
          await tx.crewProductionActivity.create({
            data: {
              crewId,
              kind: 'properties_changed',
              createdByUserId: userId,
              payload: {
                changes: [
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
