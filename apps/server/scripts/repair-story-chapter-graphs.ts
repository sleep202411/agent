import 'dotenv/config';

/**
 * Audits or repairs the StoryDraft ↔ active StoryChapter partition.
 *
 *   npm run story:repair-chapter-graphs
 *   npm run story:repair-chapter-graphs -- --write
 *   npm run story:repair-chapter-graphs -- --project <uuid>
 *   npm run story:repair-chapter-graphs -- --allow-remote --write
 *
 * Dry-run is the default. Remote access and writes are independent opt-ins.
 * Every committed repair retains exact before/after evidence in
 * story_chapter_graph_repairs.
 */
import { Prisma } from '@prisma/client';
import { buildPrisma } from '../src/infra/db/db.module';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import { InteractiveStoryDraftContentSchema } from '../src/story-studio/interactive-film.schema';
import {
  persistStoryChapterGraphRepair,
  reconcileStoryChapterGraphPartition,
  type StoryNodeChapterEvidence,
} from '../src/story-studio/story-chapter-graph-invariant';
import { StoryProjectWriteGuardService } from '../src/story-studio/story-project-write-guard.service';

const prisma = buildPrisma();
const writeGuard = new StoryProjectWriteGuardService(prisma);
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';

interface Args {
  write: boolean;
  allowRemote: boolean;
  projectId: string | null;
  limit: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertDatabaseAllowed(args);
  const reports: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;

  for (;;) {
    const drafts = await prisma.storyDraft.findMany({
      where: args.projectId ? { storyProjectId: args.projectId } : undefined,
      orderBy: { storyProjectId: 'asc' },
      take: args.limit,
      ...(cursor ? { cursor: { storyProjectId: cursor }, skip: 1 } : {}),
    });
    if (drafts.length === 0) break;
    for (const draft of drafts) {
      try {
        reports.push(
          args.write
            ? await repairProject(draft.storyProjectId)
            : await inspectProject(draft.storyProjectId),
        );
      } catch (error) {
        reports.push({
          projectId: draft.storyProjectId,
          status: 'unrepairable',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    cursor = drafts.at(-1)?.storyProjectId;
    if (args.projectId || drafts.length < args.limit) break;
  }

  console.log(
    JSON.stringify(
      {
        mode: args.write ? 'write' : 'dry-run',
        projectsScanned: reports.length,
        repairsNeeded: reports.filter((item) => item.status === 'repair_needed')
          .length,
        repaired: reports.filter((item) => item.status === 'repaired').length,
        skippedActiveWriter: reports.filter(
          (item) => item.status === 'skipped_active_writer',
        ).length,
        unrepairable: reports.filter((item) => item.status === 'unrepairable')
          .length,
        projects: reports.filter((item) => item.status !== 'valid'),
      },
      null,
      2,
    ),
  );
}

async function inspectProject(storyProjectId: string) {
  const state = await loadState(prisma, storyProjectId);
  const repaired = reconcileStoryChapterGraphPartition(state);
  return {
    projectId: storyProjectId,
    status: repaired.changed ? 'repair_needed' : 'valid',
    draftRevision: state.draft.revision,
    issues: repaired.issues,
    decisions: repaired.changed ? repaired.decisions : [],
  };
}

async function repairProject(storyProjectId: string) {
  return prisma.$transaction(
    async (tx) => {
      if (
        !(await writeGuard.tryAcquireDeferredWriteFence(tx, storyProjectId))
      ) {
        return { projectId: storyProjectId, status: 'skipped_active_writer' };
      }
      const state = await loadState(tx, storyProjectId);
      const repaired = reconcileStoryChapterGraphPartition(state);
      if (!repaired.changed)
        return { projectId: storyProjectId, status: 'valid' };
      const persisted = await persistStoryChapterGraphRepair(tx, {
        draft: state.draft,
        chapters: state.chapters,
        repaired,
        trigger: 'bulk_repair',
        actorUserId: null,
      });
      if (!persisted)
        throw new Error(`Repair CAS lost for project ${storyProjectId}.`);
      return {
        projectId: storyProjectId,
        status: 'repaired',
        draftRevisionBefore: state.draft.revision,
        draftRevisionAfter: persisted.revision,
        issues: repaired.issues,
        decisions: repaired.decisions,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function loadState(
  db: typeof prisma | Prisma.TransactionClient,
  storyProjectId: string,
) {
  const [draft, chapters, sequences, agentRuns] = await Promise.all([
    db.storyDraft.findUniqueOrThrow({ where: { storyProjectId } }),
    db.storyChapter.findMany({
      where: { storyProjectId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    }),
    db.storyStoryboardSequence.findMany({
      where: { storyProjectId, status: { not: 'archived' } },
      select: { plotNodeId: true, storyChapterId: true },
    }),
    db.storyAgentRun.findMany({
      where: { storyProjectId, afterDraftSnapshot: { not: Prisma.AnyNull } },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: { storyChapterId: true, afterDraftSnapshot: true },
      take: 50,
    }),
  ]);
  const content = InteractiveStoryDraftContentSchema.parse(draft.content);
  if (canonicalJsonHash(content) !== draft.contentHash) {
    throw new Error(
      `Draft hash mismatch for project ${storyProjectId}; no repair was written.`,
    );
  }
  const evidence: StoryNodeChapterEvidence[] = sequences.map((row) => ({
    nodeId: row.plotNodeId,
    chapterId: row.storyChapterId,
    source: 'storyboard',
  }));
  for (const run of agentRuns) {
    const snapshot = InteractiveStoryDraftContentSchema.safeParse(
      run.afterDraftSnapshot,
    );
    if (!snapshot.success) continue;
    for (const node of snapshot.data.graph.nodes) {
      evidence.push({
        nodeId: node.nodeId,
        chapterId: run.storyChapterId,
        source: 'agent_run',
      });
    }
  }
  return { draft, chapters, content, evidence };
}

function parseArgs(argv: string[]): Args {
  const projectIndex = argv.indexOf('--project');
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : 100;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new Error('--limit must be an integer between 1 and 1000.');
  }
  const projectId = projectIndex >= 0 ? argv[projectIndex + 1] : null;
  if (projectIndex >= 0 && !projectId)
    throw new Error('--project requires an id.');
  return {
    write: argv.includes('--write'),
    allowRemote: argv.includes('--allow-remote'),
    projectId,
    limit,
  };
}

function assertDatabaseAllowed(args: Args): void {
  const url = new URL(databaseUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!local && !args.allowRemote) {
    throw new Error('Remote database access requires --allow-remote.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
