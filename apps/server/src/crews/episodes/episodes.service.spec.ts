/**
 * EpisodesService.approve — the episode-wide notification fan-out.
 *
 * Same idiom as assignments.service.spec.ts: the real CrewRoleService over
 * a mocked Prisma, so the founder short-circuit is exercised rather than
 * stubbed.
 */
import { CrewRoleService } from '../crew-role.service';
import { EpisodesService } from './episodes.service';

const CREW_ID = 'crew-1';
const EPISODE_ID = 'ep-1';
const FOUNDER = 'u-founder';

function build(
  assignees: string[],
  opts: { lockedStatus?: string; lockedAssignees?: string[] } = {},
) {
  const episodeRow = {
    id: EPISODE_ID,
    number: 3,
    status: 'in_production',
    crewId: CREW_ID,
    approvedAt: null,
    title: null,
    description: null,
    deadline: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    crew: {
      id: CREW_ID,
      founderId: FOUNDER,
      name: 'Night Shift',
      deletedAt: null,
    },
    assignments: assignees.map((userId) => ({ userId })),
  };
  const lockedEpisodeRow = {
    ...episodeRow,
    status: opts.lockedStatus ?? episodeRow.status,
    assignments: (opts.lockedAssignees ?? assignees).map((userId) => ({
      userId,
    })),
  };
  const findCrew = jest.fn().mockResolvedValue({ founderId: FOUNDER });

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: EPISODE_ID }]),
    crew: { findFirst: findCrew },
    crewMember: { findFirst: jest.fn().mockResolvedValue(null) },
    episode: {
      findUnique: jest.fn().mockResolvedValue(lockedEpisodeRow),
      update: jest
        .fn()
        .mockResolvedValue({ ...lockedEpisodeRow, status: 'approved' }),
    },
    episodeActivity: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    crew: { findFirst: findCrew },
    crewMember: { findFirst: jest.fn().mockResolvedValue(null) },
    episode: { findUnique: jest.fn().mockResolvedValue(episodeRow) },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const notifications = { send: jest.fn().mockResolvedValue({}) };

  return {
    prisma,
    tx,
    notifications,
    service: new EpisodesService(
      prisma as never,
      new CrewRoleService(prisma as never),
      notifications as never,
    ),
  };
}

describe('EpisodesService.approve', () => {
  it('deeplinks every assignee to the approved episode', async () => {
    const t = build(['u-a', 'u-b']);

    await t.service.approve(EPISODE_ID, FOUNDER, 'Owner');

    expect(t.notifications.send).toHaveBeenCalledTimes(2);
    const calls = t.notifications.send.mock.calls as Array<
      [{ meta: Record<string, unknown> }]
    >;
    for (const [args] of calls) {
      // Episode-wide event: no `assignment` param, each recipient has
      // their own row.
      expect(args.meta.deeplink).toBe(
        `/crews/${CREW_ID}/workspace?tab=episodes&episode=${EPISODE_ID}`,
      );
    }
  });

  it('rechecks the locked episode state before mutating', async () => {
    const t = build(['u-a'], { lockedStatus: 'approved' });

    await expect(
      t.service.approve(EPISODE_ID, FOUNDER, 'Owner'),
    ).rejects.toMatchObject({
      response: {
        message: 'Episode is not in production',
        currentStatus: 'approved',
      },
    });

    expect(t.tx.episode.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
  });
});
