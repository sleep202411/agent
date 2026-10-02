import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';
import {
  assertStoryChapterGraphPartition,
  commitStoryChapterGraph,
  mergeChapterDraftIntoStory,
  reconcileStoryChapterGraphPartition,
  StoryChapterNodeOwnershipConflictError,
} from './story-chapter-graph-invariant';

function draft(
  ids: string[],
  entryNodeId: string | null = ids[0] ?? null,
): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: '', synopsis: '', characters: [] },
    graph: {
      entryNodeId,
      nodes: ids.map((nodeId, index) => ({
        kind: 'clip' as const,
        nodeId,
        clipKey: `S${index}`,
        interactions: [],
        exit: {
          kind: 'auto' as const,
          routes: [
            {
              target: ids[index + 1]
                ? { kind: 'node' as const, nodeId: ids[index + 1] }
                : null,
            },
          ],
        },
      })),
    },
    productionNotes: [],
  };
}

describe('story chapter graph invariant', () => {
  it('keeps every chapter-content writer on the shared transactional primitive', () => {
    const writers = [
      'src/story-studio/story-projects.service.ts',
      'src/story-studio/story-agent-run.service.ts',
      'src/agent-os-gateway/capabilities/story.handler.ts',
    ];
    for (const writer of writers) {
      const source = readFileSync(resolve(process.cwd(), writer), 'utf8');
      expect(source).toContain('commitStoryChapterGraph');
      expect(source).not.toContain('storyDraft.updateMany(');
    }
  });

  it('repairs invalid membership, duplicate ownership and entries without changing graph content', () => {
    const content = draft(['a', 'b', 'c']);
    const beforeNodes = structuredClone(content.graph.nodes);
    const repaired = reconcileStoryChapterGraphPartition({
      content,
      chapters: [
        { id: 'one', nodeIds: ['a', 'missing', 'a'], entryNodeId: 'missing' },
        { id: 'two', nodeIds: ['c', 'a'], entryNodeId: 'c' },
      ],
      evidence: [{ nodeId: 'a', chapterId: 'one', source: 'storyboard' }],
    });
    expect(repaired.changed).toBe(true);
    expect(repaired.content.graph.nodes).toEqual(beforeNodes);
    expect(repaired.chapters).toEqual([
      { id: 'one', nodeIds: ['a', 'b'], entryNodeId: 'a' },
      { id: 'two', nodeIds: ['c'], entryNodeId: 'c' },
    ]);
    expect(() =>
      assertStoryChapterGraphPartition(repaired.content, repaired.chapters),
    ).not.toThrow();
  });

  it('uses storyboard evidence before connectivity and records graph-order evidence', () => {
    const content = draft(['a', 'b', 'island']);
    const secondExit = content.graph.nodes[1].exit;
    if (secondExit.kind !== 'auto')
      throw new Error('Expected an automatic exit.');
    secondExit.routes = [{ target: null }];
    const repaired = reconcileStoryChapterGraphPartition({
      content,
      chapters: [
        { id: 'one', nodeIds: ['a'], entryNodeId: 'a' },
        { id: 'two', nodeIds: [], entryNodeId: null },
      ],
      evidence: [{ nodeId: 'b', chapterId: 'two', source: 'storyboard' }],
    });
    expect(repaired.chapters[1]?.nodeIds).toEqual(['b', 'island']);
    expect(repaired.decisions).toContainEqual({
      nodeId: 'island',
      chapterId: 'two',
      reason: 'graph_order',
    });
  });

  it('preserves a completely unanchored graph in the first chapter with audit evidence', () => {
    const content = draft(['a'], null);
    const repaired = reconcileStoryChapterGraphPartition({
      content,
      chapters: [
        { id: 'one', nodeIds: [], entryNodeId: null },
        { id: 'two', nodeIds: [], entryNodeId: null },
      ],
    });
    expect(repaired.chapters[0]).toEqual({
      id: 'one',
      nodeIds: ['a'],
      entryNodeId: null,
    });
    expect(repaired.decisions).toContainEqual({
      nodeId: 'a',
      chapterId: 'one',
      reason: 'first_chapter_fallback',
    });
  });

  it('merges append and replace saves into only the selected chapter', () => {
    const content = draft(['a', 'b']);
    const firstExit = content.graph.nodes[0].exit;
    if (firstExit.kind !== 'auto')
      throw new Error('Expected an automatic exit.');
    firstExit.routes = [{ target: null }];
    const chapters = [
      { id: 'one', nodeIds: ['a'], entryNodeId: 'a' },
      { id: 'two', nodeIds: ['b'], entryNodeId: 'b' },
    ];
    const replacement = draft(['c', 'd'], 'c');
    const merged = mergeChapterDraftIntoStory({
      content,
      chapters,
      chapterId: 'two',
      chapterContent: replacement,
    });
    expect(merged.content.graph.nodes.map((node) => node.nodeId)).toEqual([
      'a',
      'c',
      'd',
    ]);
    expect(merged.content.graph.entryNodeId).toBe('a');
    expect(merged.chapters[0]?.nodeIds).toEqual(['a']);
    expect(merged.chapters[1]).toMatchObject({
      nodeIds: ['c', 'd'],
      entryNodeId: 'c',
    });
  });

  it('rejects a save that claims another chapter node', () => {
    expect(() =>
      mergeChapterDraftIntoStory({
        content: draft(['a', 'b']),
        chapters: [
          { id: 'one', nodeIds: ['a'], entryNodeId: 'a' },
          { id: 'two', nodeIds: ['b'], entryNodeId: 'b' },
        ],
        chapterId: 'one',
        chapterContent: draft(['b']),
      }),
    ).toThrow(StoryChapterNodeOwnershipConflictError);
  });

  it('commits draft CAS, every chapter projection and repair evidence as one primitive', async () => {
    const content = draft(['a', 'b']);
    const chaptersBefore = [
      { id: 'one', nodeIds: [], entryNodeId: null },
      { id: 'two', nodeIds: [], entryNodeId: null },
    ];
    const partitionRepair = reconcileStoryChapterGraphPartition({
      content,
      chapters: chaptersBefore,
      evidence: [{ nodeId: 'b', chapterId: 'two', source: 'agent_run' }],
    });
    const tx = {
      storyDraft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      storyChapter: { update: jest.fn().mockResolvedValue({}) },
      storyChapterGraphRepair: { upsert: jest.fn().mockResolvedValue({}) },
    };

    const result = await commitStoryChapterGraph(tx as never, {
      draft: {
        storyProjectId: 'project',
        schemaVersion: 'story-v1',
        content,
        contentHash: 'before-hash',
        revision: 7,
      },
      chaptersBefore,
      partitionRepair,
      content: partitionRepair.content,
      chapters: partitionRepair.chapters,
      schemaVersion: 'story-v1',
      actorUserId: 'user',
      sessionId: null,
      trigger: 'test',
    });
    expect(typeof result?.contentHash).toBe('string');

    expect(tx.storyDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: 'project',
          revision: 7,
          contentHash: 'before-hash',
        },
      }),
    );
    expect(tx.storyChapter.update).toHaveBeenCalledTimes(2);
    expect(tx.storyChapterGraphRepair.upsert).toHaveBeenCalledTimes(1);
  });

  it('writes no chapter projection when the draft CAS loses', async () => {
    const content = draft(['a']);
    const chapters = [{ id: 'one', nodeIds: ['a'], entryNodeId: 'a' }];
    const tx = {
      storyDraft: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storyChapter: { update: jest.fn() },
      storyChapterGraphRepair: { upsert: jest.fn() },
    };
    const repair = reconcileStoryChapterGraphPartition({ content, chapters });

    await expect(
      commitStoryChapterGraph(tx as never, {
        draft: {
          storyProjectId: 'project',
          schemaVersion: 'story-v1',
          content,
          contentHash: 'stale',
          revision: 1,
        },
        chaptersBefore: chapters,
        partitionRepair: repair,
        content,
        chapters,
        schemaVersion: 'story-v1',
        actorUserId: 'user',
        sessionId: 'session',
        trigger: 'test',
      }),
    ).resolves.toBeNull();
    expect(tx.storyChapter.update).not.toHaveBeenCalled();
  });
});
