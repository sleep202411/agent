import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/db/db.module';
import { RealtimeRevokeService } from '../../infra/realtime/realtime-revoke.service';
import { DocumentsGateway } from '../../documents/documents.gateway';

/** Call after commit. Reconnects re-evaluate live crew plus independent grants. */
@Injectable()
export class CrewStudioRevocationService {
  private readonly logger = new Logger(CrewStudioRevocationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeRevokeService,
    private readonly documents: DocumentsGateway,
  ) {}

  async revoke(
    crewId: string,
    workspaceId: string,
    userId?: string,
  ): Promise<void> {
    try {
      const [members, projects, documents] = await Promise.all([
        userId
          ? Promise.resolve([{ userId }])
          : this.prisma.crewMember.findMany({
              // Include members removed concurrently with unlinking. Their removal
              // may already see the new link, so neither path may skip the old workspace.
              where: { crewId },
              select: { userId: true },
            }),
        this.prisma.storyProject.findMany({
          where: { workspaceId },
          select: { id: true },
        }),
        this.prisma.studioDocument.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true },
        }),
      ]);
      for (const userId of new Set(members.map((member) => member.userId))) {
        await this.realtime.revokeWorkspaceAccess(workspaceId, userId);
        for (const project of projects)
          await this.realtime.revokeStoryProjectAccess(project.id, userId);
        // The document gateway rechecks read access and preserves direct grants.
        await this.documents.revokeUserFromDocuments(
          documents.map((document) => document.id),
          userId,
        );
      }
    } catch (error) {
      // Authorization is already revoked by the committed state. A missed kick
      // must not report the membership write as failed; realtime token TTL is the backstop.
      this.logger.warn(
        `Crew Studio revocation failed for ${crewId}: ${String(error)}`,
      );
    }
  }
}
