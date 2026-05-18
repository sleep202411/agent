/**
 * Episode lifecycle service — create / list / approve.
 *
 * State machine (per episodes-spec.md):
 *   not_started  → in_production  (auto on first assignment.add)
 *   in_production → approved      (explicit admin call here)
 *   approved is terminal — every assignment write is frozen.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { CrewRoleService } from '../crew-role.service';
import { toEpisodeDTO } from '../mappers';
import type { CreateEpisodeInput } from './dto';
import { writeActivity } from './activity-writer';

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CrewRoleService,
    private readonly notifications: NotificationService,
  ) {}

  async list(crewId: string, viewerId: string) {
    await this.roles.require(crewId, viewerId, ['admin', 'finance', 'member']);
    const rows = await this.prisma.episode.findMany({
      where: { crewId },
      orderBy: { number: 'asc' },
    });
    return rows.map(toEpisodeDTO);
  }

  async create(
    crewId: string,
    actorId: string,
    actorName: string,
    input: CreateEpisodeInput,
  ) {
    await this.roles.require(crewId, actorId, ['admin']);

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.episode.findFirst({
        where: { crewId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      const episode = await tx.episode.create({
        data: {
          crewId,
          number,
          title: input.title ?? null,
          description: input.description ?? null,
          deadline: input.deadline
            ? new Date(`${input.deadline}T00:00:00Z`)
            : null,
        },
      });
      await writeActivity(tx, {
        crewId,
        episodeId: episode.id,
        type: 'episode_created',
        actorUserId: actorId,
        actorName,
        payload: { number },
      });
      return episode;
    });
    return toEpisodeDTO(created);
  }

  async approve(episodeId: string, actorId: string, actorName: string) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        crew: {
          select: { id: true, founderId: true, name: true, deletedAt: true },
        },
        assignments: { select: { userId: true } },
      },
    });
    if (!episode || episode.crew.deletedAt)
      throw new NotFoundException('Episode not found');
    await this.roles.require(episode.crewId, actorId, ['admin']);

    if (episode.status !== 'in_production') {
      throw new BadRequestException({
        message: 'Episode is not in production',
        currentStatus: episode.status,
        expectedStatuses: ['in_production'],
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.episode.update({
        where: { id: episodeId },
        data: { status: 'approved', approvedAt: new Date() },
      });
      await writeActivity(tx, {
        crewId: episode.crewId,
        episodeId: e.id,
        type: 'episode_approved',
        actorUserId: actorId,
        actorName,
        payload: {},
      });
      const seen = new Set<string>();
      for (const a of episode.assignments) {
        if (seen.has(a.userId)) continue;
        seen.add(a.userId);
        await this.notifications.send(
          {
            userId: a.userId,
            type: 'crew.episode.approved',
            title: `Episode ${e.number} approved`,
            body: `"${episode.crew.name}" episode ${e.number} is final.`,
            meta: {
              deeplink: `/crews/${episode.crewId}/workspace`,
              crewId: episode.crewId,
              episodeId: e.id,
            },
            idempotencyKey: `crew.episode.approved:${e.id}:${a.userId}`,
          },
          tx,
        );
      }
      return e;
    });
    return toEpisodeDTO(updated);
  }
}
