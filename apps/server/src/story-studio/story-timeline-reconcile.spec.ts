/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions intentionally inspect mocked Prisma methods by reference. */
import { StoryProductionSpecStatus, type Prisma } from '@prisma/client';
import { reconcileStoryTimelinesWithDraft } from './story-timeline-reconcile';

describe('reconcileStoryTimelinesWithDraft', () => {
  function transaction(existing: unknown[] = []) {
    return {
      storyStoryboardSequence: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
  }

  const content = {
    graph: {
      nodes: [
        { kind: 'clip', nodeId: 'clip:one' },
        { kind: 'clip', nodeId: 'clip:two' },
      ],
    },
  };

  it('creates one canonical empty timeline for every new Plot node', async () => {
    const tx = transaction();
    await reconcileStoryTimelinesWithDraft(tx, 'project-1', content, {
      storyChapterId: 'chapter-1',
      chapterNodeIds: ['clip:one', 'clip:two'],
      actorUserId: 'user-1',
    });

    expect(tx.storyStoryboardSequence.createMany).toHaveBeenCalledTimes(1);
    expect(tx.storyStoryboardSequence.createMany).toHaveBeenCalledWith({
      // Jest's asymmetric matcher is intentionally typed as any.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.arrayContaining([
        expect.objectContaining({
          storyProjectId: 'project-1',
          storyChapterId: 'chapter-1',
          plotNodeId: 'clip:one',
          stableKey: 'clip:one',
          suggestedDurationMs: 0,
          durationMs: 0,
          createdByUserId: 'user-1',
        }),
      ]),
    });
  });

  it('revives the same chapter timeline instead of creating a second identity', async () => {
    const tx = transaction([
      {
        id: 'sequence-1',
        storyChapterId: 'chapter-1',
        plotNodeId: 'clip:one',
        status: StoryProductionSpecStatus.archived,
      },
      {
        id: 'sequence-2',
        storyChapterId: 'chapter-1',
        plotNodeId: 'clip:two',
        status: StoryProductionSpecStatus.current,
      },
    ]);
    await reconcileStoryTimelinesWithDraft(tx, 'project-1', content, {
      storyChapterId: 'chapter-1',
      chapterNodeIds: ['clip:one', 'clip:two'],
      actorUserId: 'user-1',
    });

    expect(tx.storyStoryboardSequence.update).toHaveBeenCalledWith({
      where: { id: 'sequence-1' },
      data: {
        status: StoryProductionSpecStatus.current,
      },
    });
    expect(tx.storyStoryboardSequence.createMany).not.toHaveBeenCalled();
  });

  it('moves the same active timeline when chapter ownership changes', async () => {
    const tx = transaction([
      {
        id: 'sequence-1',
        storyChapterId: 'chapter-2',
        plotNodeId: 'clip:one',
        status: StoryProductionSpecStatus.current,
      },
    ]);

    await reconcileStoryTimelinesWithDraft(tx, 'project-1', content, {
      storyChapterId: 'chapter-1',
      chapterNodeIds: ['clip:one'],
      actorUserId: 'user-1',
    });

    expect(tx.storyStoryboardSequence.update).toHaveBeenCalledWith({
      where: { id: 'sequence-1' },
      data: {
        storyChapterId: 'chapter-1',
        status: StoryProductionSpecStatus.current,
      },
    });
    expect(tx.storyStoryboardSequence.createMany).not.toHaveBeenCalled();
  });

  it('fails loud when legacy data contains duplicate active timelines', async () => {
    const tx = transaction([
      {
        id: 'sequence-1',
        storyChapterId: 'chapter-1',
        plotNodeId: 'clip:one',
        status: StoryProductionSpecStatus.current,
      },
      {
        id: 'sequence-2',
        storyChapterId: 'chapter-2',
        plotNodeId: 'clip:one',
        status: StoryProductionSpecStatus.current,
      },
    ]);

    await expect(
      reconcileStoryTimelinesWithDraft(tx, 'project-1', content, {
        storyChapterId: 'chapter-1',
        chapterNodeIds: ['clip:one'],
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow('multiple active');
  });
});
