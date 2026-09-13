import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import {
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from './interactive-film.schema';

export interface StoryChapterGraphRow {
  id: string;
  nodeIds: Prisma.JsonValue;
  entryNodeId: string | null;
}

export interface StoryNodeChapterEvidence {
  nodeId: string;
  chapterId: string;
  source: 'storyboard' | 'agent_run';
}

export interface StoryDraftGraphRow {
  id: string;
  storyProjectId: string;
  schemaVersion: string;
  content: Prisma.JsonValue;
  contentHash: string;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryChapterNodeOwnershipConflictError extends Error {
  constructor(readonly nodeId: string) {
    super(`Scene ${nodeId} already belongs to another chapter.`);
    this.name = 'StoryChapterNodeOwnershipConflictError';
  }
}

export interface StoryChapterGraphRepair {
  content: InteractiveStoryDraftContent;
  chapters: Array<{
    id: string;
    nodeIds: string[];
    entryNodeId: string | null;
  }>;
  changed: boolean;
  issues: string[];
  decisions: Array<{
    nodeId: string;
    chapterId: string;
    reason:
      | 'existing_membership'
      | 'chapter_entry'
      | 'project_entry'
      | 'storyboard'
      | 'agent_run'
      | 'connected_component'
      | 'graph_order'
      | 'first_chapter_fallback';
  }>;
}

export type StoryChapterGraphMerge = ReturnType<
  typeof mergeChapterDraftIntoStory
>;

/**
 * Rebuild the chapter projection without touching graph nodes or edges.
 *
 * Older writers could update StoryDraft and StoryChapter independently. This
 * reconciler treats the graph as content authority and chapter rows as a
 * projection: strong historical evidence wins, then graph connectivity/order,
 * and only the final ownerless island falls back to the first chapter. Every
 * fallback is returned as a durable audit decision by the persistence layer.
 */
export function reconcileStoryChapterGraphPartition(input: {
  content: InteractiveStoryDraftContent;
  chapters: readonly StoryChapterGraphRow[];
  evidence?: readonly StoryNodeChapterEvidence[];
}): StoryChapterGraphRepair {
  const { content, chapters } = input;
  if (chapters.length === 0) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_GRAPH_PARTITION_UNREPAIRABLE',
      message:
        'This story has no active chapter. Restore a chapter before continuing.',
    });
  }

  const issues = chapterGraphPartitionIssues(content, chapters);
  if (issues.length === 0) {
    return {
      content,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        nodeIds: strictStringArray(chapter.nodeIds),
        entryNodeId: chapter.entryNodeId,
      })),
      changed: false,
      issues: [],
      decisions: [],
    };
  }

  const graphIds = new Set(content.graph.nodes.map((node) => node.nodeId));
  const activeChapterIds = new Set(chapters.map((chapter) => chapter.id));
  const candidates = new Map<
    string,
    Map<
      string,
      {
        reason: StoryChapterGraphRepair['decisions'][number]['reason'];
        priority: number;
      }
    >
  >();
  const addCandidate = (
    nodeId: string,
    chapterId: string,
    reason: StoryChapterGraphRepair['decisions'][number]['reason'],
  ) => {
    if (!graphIds.has(nodeId) || !activeChapterIds.has(chapterId)) return;
    const owners =
      candidates.get(nodeId) ??
      new Map<
        string,
        {
          reason: StoryChapterGraphRepair['decisions'][number]['reason'];
          priority: number;
        }
      >();
    const priority = ownershipEvidencePriority(reason);
    const current = owners.get(chapterId);
    if (!current || current.priority < priority) {
      owners.set(chapterId, { reason, priority });
    }
    candidates.set(nodeId, owners);
  };

  for (const chapter of chapters) {
    for (const nodeId of tolerantStringArray(chapter.nodeIds)) {
      addCandidate(nodeId, chapter.id, 'existing_membership');
    }
    if (chapter.entryNodeId) {
      addCandidate(chapter.entryNodeId, chapter.id, 'chapter_entry');
    }
  }
  if (content.graph.entryNodeId) {
    addCandidate(content.graph.entryNodeId, chapters[0].id, 'project_entry');
  }
  for (const item of input.evidence ?? []) {
    addCandidate(item.nodeId, item.chapterId, item.source);
  }

  const ownerByNodeId = new Map<string, string>();
  const reasonByNodeId = new Map<
    string,
    StoryChapterGraphRepair['decisions'][number]['reason']
  >();
  for (const node of content.graph.nodes) {
    const owners = candidates.get(node.nodeId);
    if (owners) {
      const strongest = Math.max(
        ...[...owners.values()].map((item) => item.priority),
      );
      const strongestOwners = [...owners].filter(
        ([, item]) => item.priority === strongest,
      );
      if (strongestOwners.length !== 1) continue;
      const strongestOwner = strongestOwners[0];
      if (!strongestOwner) continue;
      const [chapterId, evidence] = strongestOwner;
      ownerByNodeId.set(node.nodeId, chapterId);
      reasonByNodeId.set(node.nodeId, evidence.reason);
    }
  }

  // A component with exactly one known chapter has an unambiguous owner. Use
  // undirected connectivity because an incoming edge is equally useful repair
  // evidence and no edge is changed by this operation.
  const adjacency = graphAdjacency(content);
  const visited = new Set<string>();
  for (const node of content.graph.nodes) {
    if (visited.has(node.nodeId)) continue;
    const component: string[] = [];
    const pending = [node.nodeId];
    const componentOwners = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      component.push(nodeId);
      const owner = ownerByNodeId.get(nodeId);
      if (owner) componentOwners.add(owner);
      for (const adjacent of adjacency.get(nodeId) ?? [])
        pending.push(adjacent);
    }
    if (componentOwners.size !== 1) continue;
    const owner = [...componentOwners][0];
    for (const nodeId of component) {
      if (ownerByNodeId.has(nodeId)) continue;
      ownerByNodeId.set(nodeId, owner);
      reasonByNodeId.set(nodeId, 'connected_component');
    }
  }

  // StoryDraft merge order keeps each chapter's nodes contiguous. Recover an
  // ownerless run only when its nearest known neighbours agree, or when just
  // one side exists. A run between two different chapters stays ambiguous.
  const graphOrder = content.graph.nodes.map((node) => node.nodeId);
  let index = 0;
  while (index < graphOrder.length) {
    if (ownerByNodeId.has(graphOrder[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < graphOrder.length && !ownerByNodeId.has(graphOrder[index]))
      index += 1;
    const left =
      start > 0 ? ownerByNodeId.get(graphOrder[start - 1]) : undefined;
    const right =
      index < graphOrder.length
        ? ownerByNodeId.get(graphOrder[index])
        : undefined;
    const owner = left && right && left !== right ? undefined : (left ?? right);
    if (!owner) continue;
    for (let cursor = start; cursor < index; cursor += 1) {
      ownerByNodeId.set(graphOrder[cursor], owner);
      reasonByNodeId.set(graphOrder[cursor], 'graph_order');
    }
  }

  // A completely unanchored legacy island is still user content. Keep it
  // visible in the first chapter and record that low-confidence choice in the
  // repair audit; never delete it or invent an edge merely to pass validation.
  for (const nodeId of graphOrder) {
    if (ownerByNodeId.has(nodeId)) continue;
    ownerByNodeId.set(nodeId, chapters[0].id);
    reasonByNodeId.set(nodeId, 'first_chapter_fallback');
  }

  const nodeIdsByChapter = new Map(
    chapters.map((chapter) => [chapter.id, [] as string[]]),
  );
  for (const nodeId of graphOrder) {
    nodeIdsByChapter.get(ownerByNodeId.get(nodeId)!)!.push(nodeId);
  }
  const normalizedChapters = chapters.map((chapter, chapterIndex) => {
    const nodeIds = nodeIdsByChapter.get(chapter.id) ?? [];
    const originalEntry = chapter.entryNodeId;
    const projectEntry = chapterIndex === 0 ? content.graph.entryNodeId : null;
    const entryNodeId =
      (originalEntry && nodeIds.includes(originalEntry)
        ? originalEntry
        : null) ??
      (projectEntry && nodeIds.includes(projectEntry) ? projectEntry : null);
    return { id: chapter.id, nodeIds, entryNodeId };
  });
  const firstEntry = normalizedChapters[0]?.entryNodeId ?? null;
  const normalizedContent =
    content.graph.entryNodeId === firstEntry
      ? content
      : { ...content, graph: { ...content.graph, entryNodeId: firstEntry } };

  assertStoryChapterGraphPartition(normalizedContent, normalizedChapters);
  return {
    content: normalizedContent,
    chapters: normalizedChapters,
    changed: true,
    issues,
    decisions: graphOrder.map((nodeId) => ({
      nodeId,
      chapterId: ownerByNodeId.get(nodeId)!,
      reason: reasonByNodeId.get(nodeId)!,
    })),
  };
}

export function mergeChapterDraftIntoStory(input: {
  content: InteractiveStoryDraftContent;
  chapters: readonly StoryChapterGraphRow[];
  chapterId: string;
  chapterContent: InteractiveStoryDraftContent;
}): {
  content: InteractiveStoryDraftContent;
  chapters: StoryChapterGraphRepair['chapters'];
  previousChapterNodeIds: string[];
  nextChapterNodeIds: string[];
} {
  const repaired = reconcileStoryChapterGraphPartition({
    content: input.content,
    chapters: input.chapters,
  });
  const chapter = repaired.chapters.find((item) => item.id === input.chapterId);
  if (!chapter) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_NOT_FOUND',
      message: 'Story chapter not found.',
    });
  }
  const previousChapterNodeIds = chapter.nodeIds;
  const nextChapterNodeIds = input.chapterContent.graph.nodes.map(
    (node) => node.nodeId,
  );
  const otherOwners = new Set(
    repaired.chapters.flatMap((item) =>
      item.id === chapter.id ? [] : item.nodeIds,
    ),
  );
  const collision = nextChapterNodeIds.find((nodeId) =>
    otherOwners.has(nodeId),
  );
  if (collision) {
    throw new StoryChapterNodeOwnershipConflictError(collision);
  }
  const previous = new Set(previousChapterNodeIds);
  const content: InteractiveStoryDraftContent = {
    storyBible: input.chapterContent.storyBible,
    graph: {
      entryNodeId:
        repaired.chapters[0]?.id === chapter.id
          ? input.chapterContent.graph.entryNodeId
          : repaired.content.graph.entryNodeId,
      nodes: [
        ...repaired.content.graph.nodes.filter(
          (node) => !previous.has(node.nodeId),
        ),
        ...input.chapterContent.graph.nodes,
      ],
    },
    productionNotes: input.chapterContent.productionNotes,
  };
  const chapters = repaired.chapters.map((item) =>
    item.id === chapter.id
      ? {
          ...item,
          nodeIds: nextChapterNodeIds,
          entryNodeId: input.chapterContent.graph.entryNodeId,
        }
      : item,
  );
  assertStoryChapterGraphPartition(content, chapters);
  return { content, chapters, previousChapterNodeIds, nextChapterNodeIds };
}

/** Persist a repair as one CAS-protected transaction and retain exact evidence. */
export async function persistStoryChapterGraphRepair(
  tx: Prisma.TransactionClient,
  input: {
    draft: StoryDraftGraphRow;
    chapters: readonly StoryChapterGraphRow[];
    repaired: StoryChapterGraphRepair;
    trigger: string;
    actorUserId: string | null;
  },
): Promise<StoryDraftGraphRow | null> {
  if (!input.repaired.changed) return input.draft;
  const repairedContent = InteractiveStoryDraftContentSchema.parse(
    input.repaired.content,
  );
  const written = await writeStoryChapterGraphState(tx, {
    draft: input.draft,
    content: repairedContent,
    chapters: input.repaired.chapters,
    actorUserId: input.actorUserId,
    sessionId: null,
  });
  if (!written) return null;
  await recordStoryChapterGraphRepair(tx, {
    ...input,
    repairedContent,
    draftRevisionAfter: input.draft.revision + 1,
  });
  return tx.storyDraft.findUnique({
    where: { storyProjectId: input.draft.storyProjectId },
  }) as Promise<StoryDraftGraphRow | null>;
}

export async function recordStoryChapterGraphRepair(
  tx: Prisma.TransactionClient,
  input: {
    draft: Pick<
      StoryDraftGraphRow,
      'storyProjectId' | 'content' | 'contentHash' | 'revision'
    >;
    chapters: readonly StoryChapterGraphRow[];
    repaired: StoryChapterGraphRepair;
    repairedContent: InteractiveStoryDraftContent;
    draftRevisionAfter: number;
    trigger: string;
    actorUserId: string | null;
  },
): Promise<void> {
  if (!input.repaired.changed) return;
  const fingerprint = repairFingerprint(
    input.draft.storyProjectId,
    input.draft.revision,
    input.draft.content,
    input.chapters,
  );
  await tx.storyChapterGraphRepair.upsert({
    where: {
      repairFingerprint: fingerprint,
    },
    create: {
      storyProjectId: input.draft.storyProjectId,
      trigger: input.trigger.slice(0, 64),
      repairFingerprint: fingerprint,
      draftRevisionBefore: input.draft.revision,
      draftRevisionAfter: input.draftRevisionAfter,
      beforeDraft: input.draft.content as Prisma.InputJsonValue,
      repairedDraft: input.repairedContent as Prisma.InputJsonObject,
      beforeChapters: input.chapters.map((chapter) => ({
        id: chapter.id,
        nodeIds: chapter.nodeIds as Prisma.InputJsonValue,
        entryNodeId: chapter.entryNodeId,
      })) as Prisma.InputJsonArray,
      repairedChapters: input.repaired
        .chapters as unknown as Prisma.InputJsonArray,
      issues: input.repaired.issues as Prisma.InputJsonArray,
      decisions: input.repaired.decisions as unknown as Prisma.InputJsonArray,
      actorUserId: input.actorUserId,
    },
    update: {},
  });
}

/**
 * The only write primitive for replacing one chapter inside StoryDraft.
 * Draft CAS, every active chapter projection, and legacy-repair evidence are
 * committed together or rolled back together.
 */
export async function commitStoryChapterGraph(
  tx: Prisma.TransactionClient,
  input: {
    draft: Pick<
      StoryDraftGraphRow,
      | 'storyProjectId'
      | 'schemaVersion'
      | 'content'
      | 'contentHash'
      | 'revision'
    >;
    chaptersBefore: readonly StoryChapterGraphRow[];
    partitionRepair: StoryChapterGraphRepair;
    content: InteractiveStoryDraftContent;
    chapters: StoryChapterGraphRepair['chapters'];
    schemaVersion: string;
    actorUserId: string;
    sessionId: string | null;
    trigger: string;
  },
): Promise<{ contentHash: string } | null> {
  const content = InteractiveStoryDraftContentSchema.parse(input.content);
  const written = await writeStoryChapterGraphState(tx, {
    draft: input.draft,
    content,
    chapters: input.chapters,
    schemaVersion: input.schemaVersion,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
  });
  if (!written) return null;
  await recordStoryChapterGraphRepair(tx, {
    draft: input.draft,
    chapters: input.chaptersBefore,
    repaired: input.partitionRepair,
    repairedContent: input.partitionRepair.content,
    draftRevisionAfter: input.draft.revision + 1,
    trigger: input.trigger,
    actorUserId: input.actorUserId,
  });
  return written;
}

async function writeStoryChapterGraphState(
  tx: Prisma.TransactionClient,
  input: {
    draft: Pick<
      StoryDraftGraphRow,
      'storyProjectId' | 'contentHash' | 'revision'
    >;
    content: InteractiveStoryDraftContent;
    chapters: StoryChapterGraphRepair['chapters'];
    schemaVersion?: string;
    actorUserId: string | null;
    sessionId: string | null;
  },
): Promise<{ contentHash: string } | null> {
  assertStoryChapterGraphPartition(input.content, input.chapters);
  const contentHash = canonicalJsonHash(input.content);
  const claimed = await tx.storyDraft.updateMany({
    where: {
      storyProjectId: input.draft.storyProjectId,
      revision: input.draft.revision,
      contentHash: input.draft.contentHash,
    },
    data: {
      ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
      content: input.content as Prisma.InputJsonObject,
      contentHash,
      revision: { increment: 1 },
      ...(input.actorUserId ? { updatedByUserId: input.actorUserId } : {}),
      updatedBySessionId: input.sessionId,
    },
  });
  if (claimed.count !== 1) return null;
  await Promise.all(
    input.chapters.map((chapter) =>
      tx.storyChapter.update({
        where: { id: chapter.id },
        data: { nodeIds: chapter.nodeIds, entryNodeId: chapter.entryNodeId },
      }),
    ),
  );
  return { contentHash };
}

function repairFingerprint(
  projectId: string,
  revision: number,
  content: Prisma.JsonValue,
  chapters: readonly StoryChapterGraphRow[],
): string {
  return canonicalJsonHash({
    projectId,
    revision,
    content,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      nodeIds: chapter.nodeIds,
      entryNodeId: chapter.entryNodeId,
    })),
  });
}

function ownershipEvidencePriority(
  reason: StoryChapterGraphRepair['decisions'][number]['reason'],
): number {
  switch (reason) {
    case 'storyboard':
      return 60;
    case 'agent_run':
      return 50;
    case 'chapter_entry':
      return 40;
    case 'project_entry':
      return 40;
    case 'existing_membership':
      return 30;
    case 'connected_component':
      return 20;
    case 'graph_order':
      return 10;
    case 'first_chapter_fallback':
      return 0;
  }
}

export function assertStoryChapterGraphPartition(
  content: InteractiveStoryDraftContent,
  chapters: readonly StoryChapterGraphRow[],
): void {
  const issues = chapterGraphPartitionIssues(content, chapters);
  if (issues.length === 0) return;
  throw new ConflictException({
    code: 'STORY_CHAPTER_GRAPH_PARTITION_INVALID',
    message: 'The story graph and chapter structure are inconsistent.',
    issues: issues.slice(0, 50),
  });
}

export function chapterGraphPartitionIssues(
  content: InteractiveStoryDraftContent,
  chapters: readonly StoryChapterGraphRow[],
): string[] {
  const issues: string[] = [];
  const graphNodeIds = new Set(content.graph.nodes.map((node) => node.nodeId));
  const ownerByNodeId = new Map<string, string>();
  if (chapters.length === 0) issues.push('The project has no active chapter.');
  for (const chapter of chapters) {
    const nodeIds = tolerantStringArray(chapter.nodeIds);
    if (
      !Array.isArray(chapter.nodeIds) ||
      nodeIds.length !== chapter.nodeIds.length
    ) {
      issues.push(`Chapter ${chapter.id} has invalid scene membership data.`);
    }
    const local = new Set<string>();
    for (const nodeId of nodeIds) {
      if (local.has(nodeId))
        issues.push(
          `Scene ${nodeId} is repeated inside chapter ${chapter.id}.`,
        );
      local.add(nodeId);
      const owner = ownerByNodeId.get(nodeId);
      if (owner && owner !== chapter.id)
        issues.push(
          `Scene ${nodeId} belongs to both ${owner} and ${chapter.id}.`,
        );
      else ownerByNodeId.set(nodeId, chapter.id);
      if (!graphNodeIds.has(nodeId))
        issues.push(`Chapter ${chapter.id} owns missing scene ${nodeId}.`);
    }
    if (
      (nodeIds.length === 0 && chapter.entryNodeId !== null) ||
      (chapter.entryNodeId !== null && !local.has(chapter.entryNodeId))
    ) {
      issues.push(`Chapter ${chapter.id} has an invalid entry scene.`);
    }
  }
  for (const nodeId of graphNodeIds) {
    if (!ownerByNodeId.has(nodeId))
      issues.push(`Scene ${nodeId} does not belong to an active chapter.`);
  }
  if (chapters[0] && content.graph.entryNodeId !== chapters[0].entryNodeId) {
    issues.push('The project entry scene does not match its first chapter.');
  }
  return issues;
}

function tolerantStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function strictStringArray(value: Prisma.JsonValue): string[] {
  return value as string[];
}

function graphAdjacency(
  content: InteractiveStoryDraftContent,
): Map<string, Set<string>> {
  const graphIds = new Set(content.graph.nodes.map((node) => node.nodeId));
  const adjacency = new Map(
    content.graph.nodes.map((node) => [node.nodeId, new Set<string>()]),
  );
  for (const node of content.graph.nodes) {
    const targets =
      node.exit.kind === 'choice'
        ? node.exit.choices.flatMap((choice) =>
            choice.nextNodeId ? [choice.nextNodeId] : [],
          )
        : node.exit.nextNodeId
          ? [node.exit.nextNodeId]
          : [];
    for (const target of targets) {
      if (!graphIds.has(target)) continue;
      adjacency.get(node.nodeId)!.add(target);
      adjacency.get(target)!.add(node.nodeId);
    }
  }
  return adjacency;
}
