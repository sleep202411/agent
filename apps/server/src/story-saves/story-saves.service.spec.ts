import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorySavesService } from './story-saves.service';
import type { SaveBody } from './story-saves.dto';

const UPDATED_AT = new Date('2026-10-04T00:00:00.000Z');
const BODY: SaveBody = {
  contentVersion: 'v1',
  state: { currentSceneId: 'sc-2' },
  events: [],
  playback: { positionMs: 12_300, watchedMs: 20_000 },
  expectedRevision: 7,
};
const ROW = {
  userId: 'player-1',
  gameId: 'game-1',
  chapterId: 'ch-1',
  ...BODY,
  revision: 7,
  cleared: false,
  updatedAt: UPDATED_AT,
};

function uniqueConflict() {
  return new Prisma.PrismaClientKnownRequestError('Duplicate save slot', {
    code: 'P2002',
    clientVersion: '7.8.0',
  });
}

describe('StorySavesService', () => {
  const delegates = {
    storyPlaySave: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateManyAndReturn: jest.fn<
        Promise<Array<{ revision: number; updatedAt: Date }>>,
        [Prisma.StoryPlaySaveUpdateManyAndReturnArgs]
      >(),
      update: jest.fn<Promise<unknown>, [Prisma.StoryPlaySaveUpdateArgs]>(),
      create: jest.fn<
        Promise<{ revision: number; updatedAt: Date }>,
        [Prisma.StoryPlaySaveCreateArgs]
      >(),
    },
    storyPlaySaveAnchor: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
  };
  const runTransaction = async (
    operation: (client: typeof delegates) => Promise<unknown>,
    options?: unknown,
  ) => {
    void options;
    return operation(delegates);
  };
  const prisma = { ...delegates, $transaction: jest.fn(runTransaction) };
  const service = new StorySavesService(prisma as never);

  beforeEach(() => {
    for (const method of Object.values(prisma.storyPlaySave))
      method.mockReset();
    for (const method of Object.values(prisma.storyPlaySaveAnchor))
      method.mockReset();
    prisma.$transaction.mockReset().mockImplementation(runTransaction);
    prisma.storyPlaySaveAnchor.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { sizeBytes: 0 },
    });
    prisma.storyPlaySaveAnchor.findMany.mockResolvedValue([]);
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([
      { revision: 8, updatedAt: UPDATED_AT },
    ]);
  });

  it('latest ignores cleared slots and reads the checkpoint without loading graph history', async () => {
    prisma.storyPlaySave.findFirst.mockResolvedValue(ROW);
    expect(await service.latest('player-1', 'game-1')).toMatchObject({
      state: BODY.state,
      playback: BODY.playback,
      revision: 7,
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(prisma.storyPlaySave.findFirst).toHaveBeenCalledWith({
      where: { userId: 'player-1', gameId: 'game-1', cleared: false },
      orderBy: { updatedAt: 'desc' },
      select: {
        gameId: true,
        chapterId: true,
        contentVersion: true,
        state: true,
        events: true,
        playback: true,
        revision: true,
        updatedAt: true,
      },
    });
  });

  it('latest returns null when no live save exists', async () => {
    prisma.storyPlaySave.findFirst.mockResolvedValue(null);
    expect(await service.latest('player-1', 'game-1')).toBeNull();
  });

  it('a missing chapter is an empty slot at revision zero', async () => {
    prisma.storyPlaySave.findUnique.mockResolvedValue(null);
    expect(await service.chapter('player-1', 'game-1', '')).toEqual({
      save: null,
      revision: 0,
    });
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

  it('a live chapter returns a revisioned save', async () => {
    prisma.storyPlaySave.findUnique.mockResolvedValue(ROW);
    expect(await service.chapter('player-1', 'game-1', 'ch-1')).toMatchObject({
      save: { playback: BODY.playback, revision: 7 },
      revision: 7,
    });
  });

  it('a tombstone returns null while preserving its revision', async () => {
    prisma.storyPlaySave.findUnique.mockResolvedValue({
      ...ROW,
      cleared: true,
    });
    expect(await service.chapter('player-1', 'game-1', 'ch-1')).toEqual({
      save: null,
      revision: 7,
    });
  });

  it('updates only the current user and expected slot revision, acknowledging that write', async () => {
    expect(await service.save('player-1', 'game-1', 'ch-1', BODY)).toEqual({
      saved: true,
      revision: 8,
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(prisma.storyPlaySave.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: 'player-1',
        gameId: 'game-1',
        chapterId: 'ch-1',
        revision: 7,
      },
      data: {
        contentVersion: 'v1',
        state: BODY.state,
        events: [],
        playback: BODY.playback,
        cleared: false,
        revision: { increment: 1 },
      },
      select: { revision: true, updatedAt: true, journey: true },
    });
    expect(prisma.storyPlaySave.create).not.toHaveBeenCalled();
    expect(prisma.storyPlaySave.findUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'maps a missing or null playback cursor to SQL NULL (%s)',
    async (playback) => {
      await service.save('player-1', 'game-1', 'ch-1', { ...BODY, playback });
      expect(
        prisma.storyPlaySave.updateManyAndReturn.mock.calls[0][0].data.playback,
      ).toBe(Prisma.DbNull);
    },
  );

  it('creates an absent slot at revision one only when the client expected zero', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    prisma.storyPlaySave.create.mockResolvedValue({
      revision: 1,
      updatedAt: UPDATED_AT,
    });
    expect(
      await service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        expectedRevision: 0,
      }),
    ).toMatchObject({ saved: true, revision: 1 });
    expect(prisma.storyPlaySave.create).toHaveBeenCalledWith({
      data: {
        userId: 'player-1',
        gameId: 'game-1',
        chapterId: 'ch-1',
        contentVersion: 'v1',
        state: BODY.state,
        events: [],
        playback: BODY.playback,
        cleared: false,
        revision: 1,
      },
      select: { revision: true, updatedAt: true, journey: true },
    });
  });

  it('rejects a stale write instead of recreating or overwriting the slot', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    await expect(
      service.save('player-1', 'game-1', 'ch-1', BODY),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.storyPlaySave.create).not.toHaveBeenCalled();
  });

  it('turns the first-write unique race into a readable conflict', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    prisma.storyPlaySave.create.mockRejectedValue(uniqueConflict());
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Save has changed. Reload the latest save before trying again.',
    });
  });

  it('does not disguise a storage failure as a revision conflict', async () => {
    const failure = new Error('Database unavailable');
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    prisma.storyPlaySave.create.mockRejectedValue(failure);
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        expectedRevision: 0,
      }),
    ).rejects.toBe(failure);
  });

  it('clears state, parked events and media cursor but retains the slot and incremented revision', async () => {
    expect(await service.clear('player-1', 'game-1', 'ch-1', 7)).toEqual({
      cleared: true,
      revision: 8,
    });
    expect(prisma.storyPlaySave.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: 'player-1',
        gameId: 'game-1',
        chapterId: 'ch-1',
        revision: 7,
      },
      data: {
        contentVersion: '',
        state: {},
        events: [],
        playback: Prisma.DbNull,
        cleared: true,
        journey: Prisma.DbNull,
        revision: { increment: 1 },
      },
      select: { revision: true, updatedAt: true, journey: true },
    });
  });

  it('creates an empty-slot tombstone so a late revision-zero write cannot restore the prior run', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    prisma.storyPlaySave.create.mockResolvedValue({
      revision: 1,
      updatedAt: UPDATED_AT,
    });
    expect(await service.clear('player-1', 'game-1', 'ch-1', 0)).toEqual({
      cleared: true,
      revision: 1,
    });
    expect(prisma.storyPlaySave.create.mock.calls[0][0].data).toMatchObject({
      userId: 'player-1',
      gameId: 'game-1',
      chapterId: 'ch-1',
      state: {},
      events: [],
      playback: Prisma.DbNull,
      cleared: true,
      revision: 1,
    });
  });

  it('rejects a late clear without deleting a newer save', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    await expect(
      service.clear('player-1', 'game-1', 'ch-1', 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.storyPlaySave.create).not.toHaveBeenCalled();
  });

  it('rejects a racing first clear with the same conflict contract', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    prisma.storyPlaySave.create.mockRejectedValue(uniqueConflict());
    await expect(
      service.clear('player-1', 'game-1', 'ch-1', 0),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(['state', 'playback'] as const)(
    'includes %s in the 128KiB cap',
    async (field) => {
      const body = { ...BODY, [field]: { blob: 'x'.repeat(129 * 1024) } };
      await expect(
        service.save('player-1', 'game-1', 'ch-1', body),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.storyPlaySave.updateManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.storyPlaySave.create).not.toHaveBeenCalled();
    },
  );

  it('counts the combined payload rather than granting separate per-field caps', async () => {
    const body = {
      ...BODY,
      state: { blob: 'x'.repeat(70 * 1024) },
      playback: { blob: 'x'.repeat(70 * 1024) },
    };
    await expect(
      service.save('player-1', 'game-1', 'ch-1', body),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts UTF-8 bytes in the payload cap', async () => {
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        state: { blob: '中'.repeat(50 * 1024) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  const edge = {
    fromSceneId: 'scene-a',
    bindingId: 'choice',
    routeId: 'left',
    toSceneId: 'scene-b',
  };
  const anchor = {
    sceneId: 'scene-a',
    state: { currentSceneId: 'scene-a' },
    events: [],
    requiredAccessRefs: [],
  };
  const delta = {
    version: 1 as const,
    signature: 'graph-v1',
    addedVisitedNodeIds: ['scene-a'],
    addedTraversedEdges: [],
    addedTraversedPaths: [],
    addedWatchedMedia: [],
    anchors: [anchor],
  };
  const metadata = {
    version: 1,
    signature: 'graph-v1',
    visitedNodeIds: ['scene-a'],
    traversedEdges: [],
    traversedPaths: [],
    watchedMedia: [],
    activeAccessRefs: [],
  };

  it('assembles full journey in visit order while latest omits heavy history', async () => {
    const journey = { ...metadata, visitedNodeIds: ['scene-a', 'scene-b'] };
    const second = { ...anchor, sceneId: 'scene-b' };
    prisma.storyPlaySave.findUnique.mockResolvedValue({ ...ROW, journey });
    prisma.storyPlaySaveAnchor.findMany.mockResolvedValue([
      { sceneId: 'scene-b', anchor: second },
      { sceneId: 'scene-a', anchor },
    ]);
    const result = await service.chapter('player-1', 'game-1', 'ch-1');
    expect(result.save?.journey).toEqual({
      ...journey,
      anchors: [anchor, second],
    });
    expect(prisma.storyPlaySaveAnchor.findMany).toHaveBeenCalledWith({
      where: { userId: 'player-1', gameId: 'game-1', chapterId: 'ch-1' },
      select: { sceneId: true, anchor: true },
    });
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    prisma.storyPlaySave.findFirst.mockResolvedValue({ ...ROW, journey });
    expect(await service.latest('player-1', 'game-1')).not.toHaveProperty(
      'journey',
    );
  });

  it('does not touch anchors or metadata during ordinary progress writes', async () => {
    await service.save('player-1', 'game-1', 'ch-1', BODY);
    expect(prisma.storyPlaySave.update).not.toHaveBeenCalled();
    expect(prisma.storyPlaySaveAnchor.upsert).not.toHaveBeenCalled();
    expect(prisma.storyPlaySaveAnchor.aggregate).not.toHaveBeenCalled();
  });

  it('rejects a stale revision before mutating any journey data', async () => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([]);
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        journeyDelta: delta,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.storyPlaySaveAnchor.deleteMany).not.toHaveBeenCalled();
    expect(prisma.storyPlaySaveAnchor.upsert).not.toHaveBeenCalled();
  });

  it('deduplicates actual route paths and preserves the furthest watched bound', async () => {
    const media = {
      sceneId: 'scene-a',
      rendererInstanceId: 'video-a',
      sequenceIndex: 0,
      assetId: 'asset-a',
      mediaSignature: 'media-v1',
      watchedUntilMs: 4000,
    };
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([
      {
        revision: 8,
        updatedAt: UPDATED_AT,
        journey: {
          ...metadata,
          traversedEdges: [edge],
          traversedPaths: [[edge]],
          watchedMedia: [media],
        },
      },
    ] as never);
    await service.save('player-1', 'game-1', 'ch-1', {
      ...BODY,
      journeyDelta: {
        ...delta,
        addedTraversedEdges: [edge, { ...edge, routeId: 'right' }],
        addedTraversedPaths: [[edge]],
        addedWatchedMedia: [{ ...media, watchedUntilMs: 2000 }],
        anchors: [],
      },
    });
    expect(
      prisma.storyPlaySave.update.mock.calls[0][0].data.journey,
    ).toMatchObject({
      visitedNodeIds: ['scene-a'],
      traversedEdges: [edge, { ...edge, routeId: 'right' }],
      traversedPaths: [[edge]],
      watchedMedia: [media],
    });
    expect(prisma.storyPlaySaveAnchor.deleteMany).not.toHaveBeenCalled();
  });

  const activeAccessRefs = [
    { kind: 'node' as const, sceneId: 'scene-a' },
    {
      kind: 'route' as const,
      sceneId: 'scene-a',
      bindingId: 'choice',
      routeId: 'paid',
    },
  ];
  it.each([
    ['retains omitted boundaries', undefined],
    ['clears boundaries on an explicit rewind', []],
    [
      'replaces boundaries with the selected entry chain',
      activeAccessRefs.slice(0, 1),
    ],
  ] as const)('%s', async (_label, replacement) => {
    prisma.storyPlaySave.updateManyAndReturn.mockResolvedValue([
      {
        revision: 8,
        updatedAt: UPDATED_AT,
        journey: { ...metadata, activeAccessRefs },
      },
    ] as never);
    await service.save('player-1', 'game-1', 'ch-1', {
      ...BODY,
      journeyDelta: {
        ...delta,
        anchors: [],
        ...(replacement === undefined
          ? {}
          : { activeAccessRefs: [...replacement] }),
      },
    });
    expect(
      prisma.storyPlaySave.update.mock.calls[0][0].data.journey,
    ).toMatchObject({ activeAccessRefs: replacement ?? activeAccessRefs });
  });

  it('requires anchors to name distinct visited nodes', async () => {
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        journeyDelta: { ...delta, anchors: [anchor, anchor] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        journeyDelta: {
          ...delta,
          anchors: [{ ...anchor, sceneId: 'unvisited' }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes accumulated anchors in the full journey data limit', async () => {
    prisma.storyPlaySaveAnchor.aggregate.mockResolvedValue({
      _count: 1,
      _sum: { sizeBytes: 8 * 1024 * 1024 },
    });
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        journeyDelta: delta,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyPlaySave.update).not.toHaveBeenCalled();
  });

  it('surfaces damaged stored metadata instead of resetting it silently', async () => {
    prisma.storyPlaySave.findUnique.mockResolvedValue({
      ...ROW,
      journey: { version: 2 },
    });
    await expect(
      service.chapter('player-1', 'game-1', 'ch-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects an oversized changed anchor independently of the current checkpoint budget', async () => {
    await expect(
      service.save('player-1', 'game-1', 'ch-1', {
        ...BODY,
        journeyDelta: {
          ...delta,
          anchors: [{ ...anchor, state: { blob: 'x'.repeat(129 * 1024) } }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storyPlaySave.updateManyAndReturn).not.toHaveBeenCalled();
  });
});
