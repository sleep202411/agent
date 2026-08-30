import 'dotenv/config';

/**
 * Audits and repairs the Plot-node ↔ Storyboard identity invariant.
 *
 * Run after the empty-timeline migration is deployed:
 *   npm run storyboard:repair-identities                 # dry-run
 *   npm run storyboard:repair-identities -- --write      # local write
 *   npm run storyboard:repair-identities -- --allow-remote
 *   npm run storyboard:repair-identities -- --allow-remote --write
 *
 * Remote access is always opt-in. Ambiguous projects are reported and left
 * untouched; safe projects are repaired transactionally and idempotently.
 */
import {
  Prisma,
  StoryProductionPlanDisposition,
  StoryProductionSpecStatus,
} from '@prisma/client';
import { buildPrisma } from '../src/infra/db/db.module';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import { InteractiveStoryDraftContentSchema } from '../src/story-studio/dto';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const prisma = buildPrisma();

type Args = {
  write: boolean;
  allowRemote: boolean;
  limit: number;
  projectId: string | null;
};

type ProjectRepair = {
  projectId: string;
  orphanSequences: number;
  missingSequences: number;
  conflicts: string[];
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertDatabaseAllowed(args);
  const results: ProjectRepair[] = [];
  let projectsScanned = 0;
  let cursor: string | undefined;
  while (true) {
    const drafts = await prisma.storyDraft.findMany({
      where: args.projectId ? { storyProjectId: args.projectId } : undefined,
      orderBy: { storyProjectId: 'asc' },
      take: args.limit,
      ...(cursor ? { cursor: { storyProjectId: cursor }, skip: 1 } : {}),
    });
    if (drafts.length === 0) break;
    for (const draft of drafts) {
      const result = await inspectProject(draft.storyProjectId);
      results.push(result);
      projectsScanned += 1;
      if (args.write && result.conflicts.length === 0) {
        await repairProject(draft.storyProjectId);
      }
    }
    cursor = drafts.at(-1)?.storyProjectId;
    if (args.projectId || drafts.length < args.limit) break;
  }

  const totals = results.reduce(
    (sum, item) => ({
      orphanSequences: sum.orphanSequences + item.orphanSequences,
      missingSequences: sum.missingSequences + item.missingSequences,
      conflicts: sum.conflicts + item.conflicts.length,
    }),
    { orphanSequences: 0, missingSequences: 0, conflicts: 0 },
  );
  console.log(
    JSON.stringify(
      {
        mode: args.write ? 'write' : 'dry-run',
        projectsScanned,
        ...totals,
        projects: results.filter(
          (item) =>
            item.orphanSequences > 0 ||
            item.missingSequences > 0 ||
            item.conflicts.length > 0,
        ),
      },
      null,
      2,
    ),
  );
  if (args.write && totals.conflicts > 0) {
    throw new Error(
      'Some projects have ambiguous identity conflicts and were not changed. Resolve the reported projects, then rerun the repair.',
    );
  }
}

async function inspectProject(storyProjectId: string): Promise<ProjectRepair> {
  const [draft, chapters, sequences] = await Promise.all([
    prisma.storyDraft.findUniqueOrThrow({ where: { storyProjectId } }),
    prisma.storyChapter.findMany({
      where: { storyProjectId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    }),
    prisma.storyStoryboardSequence.findMany({
      where: {
        storyProjectId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const content = InteractiveStoryDraftContentSchema.parse(draft.content);
  const graphById = new Map(
    content.graph.nodes.map((node) => [node.nodeId, node] as const),
  );
  const owners = chapterOwners(chapters);
  const sequencesByNode = groupBy(sequences, (row) => row.plotNodeId);
  const conflicts: string[] = [];

  for (const [nodeId, chapterIds] of owners) {
    if (chapterIds.length > 1) {
      conflicts.push(
        `Plot node ${nodeId} is owned by multiple chapters: ${chapterIds.join(', ')}.`,
      );
    }
  }
  for (const [nodeId, rows] of sequencesByNode) {
    if (rows.length > 1) {
      conflicts.push(
        `Plot node ${nodeId} has multiple active Storyboard timelines: ${rows.map((row) => row.id).join(', ')}.`,
      );
    }
    const graphNode = graphById.get(nodeId);
    if (graphNode && graphNode.kind !== 'clip') {
      conflicts.push(
        `Storyboard timeline ${rows[0]?.id ?? '-'} collides with non-Plot graph node ${nodeId}.`,
      );
    }
    if (graphNode) {
      const owner = owners.get(nodeId)?.[0];
      if (!owner) {
        conflicts.push(`Plot node ${nodeId} has no active chapter owner.`);
      } else if (rows[0] && rows[0].storyChapterId !== owner) {
        conflicts.push(
          `Plot node ${nodeId} belongs to chapter ${owner} but its Storyboard timeline belongs to ${rows[0].storyChapterId}.`,
        );
      }
    } else if (
      !chapters.some((chapter) => chapter.id === rows[0]?.storyChapterId)
    ) {
      conflicts.push(
        `Orphan Storyboard timeline ${rows[0]?.id ?? '-'} belongs to an archived or missing chapter.`,
      );
    }
  }
  for (const node of content.graph.nodes) {
    if (node.kind === 'clip' && !owners.get(node.nodeId)?.length) {
      conflicts.push(`Plot node ${node.nodeId} has no active chapter owner.`);
    }
  }

  return {
    projectId: storyProjectId,
    orphanSequences: sequences.filter((row) => !graphById.has(row.plotNodeId))
      .length,
    missingSequences: content.graph.nodes.filter(
      (node) => node.kind === 'clip' && !sequencesByNode.has(node.nodeId),
    ).length,
    conflicts: [...new Set(conflicts)],
  };
}

async function repairProject(storyProjectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "story_project_id"
      FROM "story_drafts"
      WHERE "story_project_id" = ${storyProjectId}::uuid
      FOR UPDATE
    `;
    const [draft, chapters, sequences] = await Promise.all([
      tx.storyDraft.findUniqueOrThrow({ where: { storyProjectId } }),
      tx.storyChapter.findMany({
        where: { storyProjectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      }),
      tx.storyStoryboardSequence.findMany({
        where: {
          storyProjectId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const content = InteractiveStoryDraftContentSchema.parse(draft.content);
    const nodes = [...content.graph.nodes];
    const graphIds = new Set(nodes.map((node) => node.nodeId));
    const clipKeys = new Set(
      nodes.flatMap((node) => (node.kind === 'clip' ? [node.clipKey] : [])),
    );
    const chapterNodeIds = new Map(
      chapters.map((chapter) => [chapter.id, jsonStringArray(chapter.nodeIds)]),
    );
    let graphChanged = false;

    for (const sequence of sequences) {
      if (graphIds.has(sequence.plotNodeId)) continue;
      const nodeIds = chapterNodeIds.get(sequence.storyChapterId);
      if (!nodeIds)
        throw new Error(`Missing active chapter ${sequence.storyChapterId}.`);
      const clipKey = allocateClipKey(clipKeys, nodes.length + 1);
      nodes.push({
        kind: 'clip',
        nodeId: sequence.plotNodeId,
        clipKey,
        ...(sequence.title?.trim() ? { name: sequence.title.trim() } : {}),
        interactions: [],
        exit: { kind: 'auto', nextNodeId: null },
      });
      graphIds.add(sequence.plotNodeId);
      clipKeys.add(clipKey);
      if (!nodeIds.includes(sequence.plotNodeId))
        nodeIds.push(sequence.plotNodeId);
      graphChanged = true;
    }

    const sequenceNodeIds = new Set(sequences.map((row) => row.plotNodeId));
    const ownerByNode = new Map<string, string>();
    for (const [chapterId, nodeIds] of chapterNodeIds) {
      for (const nodeId of nodeIds) ownerByNode.set(nodeId, chapterId);
    }
    for (const node of nodes) {
      if (node.kind !== 'clip' || sequenceNodeIds.has(node.nodeId)) continue;
      const storyChapterId = ownerByNode.get(node.nodeId);
      if (!storyChapterId)
        throw new Error(`Plot node ${node.nodeId} has no owner.`);
      await tx.storyStoryboardSequence.create({
        data: {
          storyProjectId,
          storyChapterId,
          plotNodeId: node.nodeId,
          stableKey: node.nodeId,
          title: null,
          description: null,
          suggestedDurationMs: 0,
          durationMs: 0,
          sourceFingerprint: canonicalJsonHash({
            kind: 'empty-storyboard-timeline',
            storyProjectId,
            plotNodeId: node.nodeId,
          }),
          planDisposition: StoryProductionPlanDisposition.user_override,
          createdByUserId: draft.updatedByUserId,
        },
      });
    }

    // Legacy sequence titles are retained as inert recovery data. New readers
    // and writers use the Plot node name exclusively, but deleting the old
    // value during the identity migration would make rollback/data forensics
    // lossy when the historical sources disagree.

    if (graphChanged) {
      const nextContent = InteractiveStoryDraftContentSchema.parse({
        ...content,
        graph: { ...content.graph, nodes },
      });
      const updated = await tx.storyDraft.updateMany({
        where: {
          storyProjectId,
          revision: draft.revision,
          contentHash: draft.contentHash,
        },
        data: {
          content: nextContent as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(nextContent),
          revision: { increment: 1 },
          updatedBySessionId: null,
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Draft ${storyProjectId} changed during repair.`);
      }
      for (const chapter of chapters) {
        await tx.storyChapter.update({
          where: { id: chapter.id },
          data: { nodeIds: chapterNodeIds.get(chapter.id) ?? [] },
        });
      }
    }
    await tx.storyProject.update({
      where: { id: storyProjectId },
      data: { updatedAt: new Date() },
    });
  });
}

function chapterOwners(
  chapters: Array<{ id: string; nodeIds: Prisma.JsonValue }>,
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const chapter of chapters) {
    for (const nodeId of jsonStringArray(chapter.nodeIds)) {
      const values = owners.get(nodeId) ?? [];
      values.push(chapter.id);
      owners.set(nodeId, values);
    }
  }
  return owners;
}

function groupBy<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const values = result.get(key) ?? [];
    values.push(item);
    result.set(key, values);
  }
  return result;
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function allocateClipKey(
  existing: ReadonlySet<string>,
  ordinal: number,
): string {
  let candidate = `SCENE_${ordinal}`;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `SCENE_${ordinal}_${suffix++}`;
  return candidate;
}

function parseArgs(argv: string[]): Args {
  const limitValue = readOption(argv, 'limit');
  const limit = limitValue ? Number(limitValue) : 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('--limit must be an integer between 1 and 10000.');
  }
  return {
    write: argv.includes('--write'),
    allowRemote: argv.includes('--allow-remote'),
    limit,
    projectId: readOption(argv, 'project-id') ?? null,
  };
}

function readOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function assertDatabaseAllowed(args: Args): void {
  if (
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('[::1]')
  ) {
    return;
  }
  if (!args.allowRemote) {
    throw new Error(
      'Refusing to inspect a non-local database. Pass --allow-remote only for an approved audit or maintenance window.',
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
