import { BadRequestException } from '@nestjs/common';
import { StorySavesService } from './story-saves.service';

describe('StorySavesService', () => {
  const prisma = {
    storyPlaySave: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const service = new StorySavesService(prisma as never);

  beforeEach(() => {
    for (const method of Object.values(prisma.storyPlaySave))
      method.mockReset();
  });

  it('latest resolves the most recently updated chapter slot', async () => {
    prisma.storyPlaySave.findFirst.mockResolvedValue({
      gameId: 'game-1',
      chapterId: 'ch-2',
      contentVersion: 'v1',
      state: { currentSceneId: 'sc-9' },
      events: [],
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    });
    const result = await service.latest('player-1', 'game-1');
    expect(prisma.storyPlaySave.findFirst).toHaveBeenCalledWith({
      where: { userId: 'player-1', gameId: 'game-1' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toEqual({
      gameId: 'game-1',
      chapterId: 'ch-2',
      contentVersion: 'v1',
      state: { currentSceneId: 'sc-9' },
      events: [],
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
  });

  it('latest returns null when the game has no saves', async () => {
    prisma.storyPlaySave.findFirst.mockResolvedValue(null);
    expect(await service.latest('player-1', 'game-1')).toBeNull();
  });

  it('chapter addresses the composite slot key', async () => {
    prisma.storyPlaySave.findUnique.mockResolvedValue(null);
    await service.chapter('player-1', 'game-1', '');
    expect(prisma.storyPlaySave.findUnique).toHaveBeenCalledWith({
      where: {
        userId_gameId_chapterId: {
          userId: 'player-1',
          gameId: 'game-1',
          chapterId: '',
        },
      },
    });
  });

  it('save upserts into the slot', async () => {
    prisma.storyPlaySave.upsert.mockResolvedValue({
      updatedAt: new Date('2026-10-02T01:00:00.000Z'),
    });
    const body = {
      contentVersion: 'v1',
      state: { currentSceneId: 'sc-2' },
      events: [],
    };
    await service.save('player-1', 'game-1', 'ch-1', body);
    expect(prisma.storyPlaySave.upsert).toHaveBeenCalledWith({
      where: {
        userId_gameId_chapterId: {
          userId: 'player-1',
          gameId: 'game-1',
          chapterId: 'ch-1',
        },
      },
      create: {
        userId: 'player-1',
        gameId: 'game-1',
        chapterId: 'ch-1',
        contentVersion: 'v1',
        state: body.state,
        events: body.events,
      },
      update: { contentVersion: 'v1', state: body.state, events: body.events },
    });
  });

  it('save rejects payloads over the size cap', async () => {
    const huge = { currentSceneId: 'sc-1', blob: 'x'.repeat(129 * 1024) };
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        contentVersion: 'v1',
        state: huge,
        events: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyPlaySave.upsert).not.toHaveBeenCalled();
  });

  it('clear is idempotent via deleteMany', async () => {
    prisma.storyPlaySave.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.clear('player-1', 'game-1', 'ch-1')).resolves.toEqual({
      cleared: true,
    });
    expect(prisma.storyPlaySave.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'player-1', gameId: 'game-1', chapterId: 'ch-1' },
    });
  });
});
