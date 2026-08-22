import { Prisma, StoryProductionSpecStatus } from '@prisma/client';

interface DraftGraphContent {
  graph: { nodes: Array<{ kind: string; nodeId: string }> };
}

/**
 * Lifecycle sync between the plot tree and its storyboard. A sequence is the
 * production filling of exactly one plot node, so the two stay 1:1 the moment
 * a draft is saved: deleting the node archives its sequence immediately
 * (soft — clips and generated media stay), and a node brought back by undo
 * revives its sequence. Content-level drift is still reconciled at plan
 * boundaries; this covers existence only.
 */
export async function reconcileStoryTimelinesWithDraft(
  tx: Prisma.TransactionClient,
  storyProjectId: string,
  content: DraftGraphContent,
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
    data: { status: StoryProductionSpecStatus.archived },
  });
  if (liveNodeIds.length > 0) {
    await tx.storyStoryboardSequence.updateMany({
      where: {
        storyProjectId,
        status: StoryProductionSpecStatus.archived,
        plotNodeId: { in: liveNodeIds },
      },
      // `stale` legally requires a pending fingerprint (stale_shape_chk), so a
      // revived sequence returns as `current`; content drift, if any, is the
      // next plan reconcile's job.
      data: { status: StoryProductionSpecStatus.current },
    });
  }
}
