import { Prisma, StoryProductionSpecStatus } from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';

interface DraftGraphContent {
  graph: { nodes: Array<{ kind: string; nodeId: string }> };
}

interface StoryTimelineReconcileScope {
  storyChapterId: string;
  chapterNodeIds: readonly string[];
  actorUserId: string;
}

/**
 * Lifecycle sync between the plot tree and its storyboard. A sequence is the
 * production detail of exactly one plot node, so the two stay 1:1 the moment
 * a draft is saved: a new node gets an empty timeline, deleting the node
 * archives its timeline immediately (soft — clips and generated media stay),
 * and a node brought back by undo revives it. Content-level drift is still
 * reconciled at plan boundaries; this covers identity and existence only.
 */
export async function reconcileStoryTimelinesWithDraft(
  tx: Prisma.TransactionClient,
  storyProjectId: string,
  content: DraftGraphContent,
  scope: StoryTimelineReconcileScope,
): Promise<void> {
  const liveNodeIds = content.graph.nodes
    .filter((node) => node.kind === 'clip')
    .map((node) => node.nodeId);
  await tx.storyStoryboardSequence.updateMany({
    where: {
      storyProjectId,
      status: { not: StoryProductionSpecStatus.archived },
      ...(liveNodeIds.length > 0 ? { plotNodeId: { notIn: liveNodeIds } } : {}),
    },
    data: {
      status: StoryProductionSpecStatus.archived,
    },
  });
  const chapterNodeIds = new Set(scope.chapterNodeIds);
  const chapterPlotNodeIds = liveNodeIds.filter((nodeId) =>
    chapterNodeIds.has(nodeId),
  );
  if (chapterPlotNodeIds.length === 0) return;

  const existing = await tx.storyStoryboardSequence.findMany({
    where: {
      storyProjectId,
      plotNodeId: { in: chapterPlotNodeIds },
    },
    select: {
      id: true,
      storyChapterId: true,
      plotNodeId: true,
      status: true,
    },
  });
  const byNode = new Map<string, (typeof existing)[number][]>();
  for (const row of existing) {
    const rows = byNode.get(row.plotNodeId) ?? [];
    rows.push(row);
    byNode.set(row.plotNodeId, rows);
  }

  const created: Prisma.StoryStoryboardSequenceCreateManyInput[] = [];
  for (const plotNodeId of chapterPlotNodeIds) {
    const rows = byNode.get(plotNodeId) ?? [];
    const activeRows = rows.filter(
      (row) => row.status !== StoryProductionSpecStatus.archived,
    );
    if (activeRows.length > 1) {
      throw new Error(
        `Plot node ${plotNodeId} has multiple active Storyboard timelines. Run the Storyboard identity repair before saving this draft.`,
      );
    }
    const owned = rows.find(
      (row) => row.storyChapterId === scope.storyChapterId,
    );
    const active = activeRows[0];
    if (active) {
      if (active.storyChapterId === scope.storyChapterId) continue;
      if (owned) {
        throw new Error(
          `Plot node ${plotNodeId} has competing Storyboard history in its new chapter. Run the Storyboard identity repair before saving this draft.`,
        );
      }
      // Chapter is only the current view/ownership scope. Moving a Plot node
      // moves the same timeline identity; scoped child rows follow through
      // their ON UPDATE CASCADE foreign keys.
      await tx.storyStoryboardSequence.update({
        where: { id: active.id },
        data: {
          storyChapterId: scope.storyChapterId,
          status: StoryProductionSpecStatus.current,
        },
      });
      continue;
    }
    if (owned) {
      await tx.storyStoryboardSequence.update({
        where: { id: owned.id },
        data: { status: StoryProductionSpecStatus.current },
      });
      continue;
    }
    if (rows.length > 1) {
      throw new Error(
        `Plot node ${plotNodeId} has multiple archived Storyboard timelines. Run the Storyboard identity repair before saving this draft.`,
      );
    }
    if (rows[0]) {
      await tx.storyStoryboardSequence.update({
        where: { id: rows[0].id },
        data: {
          storyChapterId: scope.storyChapterId,
          status: StoryProductionSpecStatus.current,
        },
      });
      continue;
    }

    created.push({
      storyProjectId,
      storyChapterId: scope.storyChapterId,
      plotNodeId,
      stableKey: plotNodeId,
      title: null,
      description: null,
      suggestedDurationMs: 0,
      durationMs: 0,
      sourceFingerprint: canonicalJsonHash({
        kind: 'empty-storyboard-timeline',
        storyProjectId,
        plotNodeId,
      }),
      createdByUserId: scope.actorUserId,
    });
  }
  for (let offset = 0; offset < created.length; offset += 500) {
    await tx.storyStoryboardSequence.createMany({
      data: created.slice(offset, offset + 500),
    });
  }
}
