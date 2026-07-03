/**
 * Backfill: legacy story-studio drafts (PlatformProject projectType='story-studio'
 * + their 'canvas' PlatformDocument snapshot) → the sovereign story_projects /
 * story_drafts tables (docs/story-studio-project-schema-v1.md §5).
 *
 * - SAME project id is reused, so existing editor links (?projectId=…) keep working.
 * - Idempotent: a StoryProject with the same id short-circuits the row.
 * - The legacy PlatformProject is archived after copy (write mode) so it stops
 *   polluting generic project lists; its document is left in place (harmless,
 *   nothing reads it once the client switch ships).
 *
 * Usage:
 *   npx tsx scripts/backfill-story-projects.ts            # dry run
 *   npx tsx scripts/backfill-story-projects.ts --write    # apply
 *   ALLOW_REMOTE=1 … --write                              # non-local DATABASE_URL
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 4 }),
});

const WRITE = process.argv.includes('--write');
const TITLE_MAX = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main() {
  if (
    !/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) &&
    process.env.ALLOW_REMOTE !== '1'
  ) {
    throw new Error('Non-local DATABASE_URL — set ALLOW_REMOTE=1 to proceed.');
  }

  const legacy = await prisma.platformProject.findMany({
    where: { projectType: 'story-studio', deletedAt: null },
    include: {
      documents: {
        where: { type: 'canvas', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
  });
  console.log(`legacy story-studio platform projects: ${legacy.length}`);

  let copied = 0;
  let skipped = 0;
  for (const project of legacy) {
    const existing = await prisma.storyProject.findUnique({
      where: { id: project.id },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const doc = project.documents[0];
    const snapshot = isRecord(doc?.contentSnapshot) ? doc.contentSnapshot : {};
    const title =
      (typeof snapshot.title === 'string' && snapshot.title.trim()) ||
      project.name ||
      'Untitled Story';
    const summary =
      typeof snapshot.summary === 'string' && snapshot.summary.trim()
        ? snapshot.summary.trim()
        : null;

    console.log(
      `${WRITE ? 'copy' : '[dry] would copy'} ${project.id} "${title}" (owner=${project.createdById}, snapshot=${doc ? 'yes' : 'EMPTY'})`,
    );
    if (!WRITE) {
      copied += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.storyProject.create({
        data: {
          id: project.id, // same id — old editor links keep working
          ownerUserId: project.createdById,
          workspaceId: project.workspaceId,
          title: title.slice(0, TITLE_MAX),
          summary,
          draft: {
            create: {
              content: snapshot as Prisma.InputJsonObject,
              updatedByUserId: project.createdById,
            },
          },
        },
      });
      await tx.platformProject.update({
        where: { id: project.id },
        data: { status: 'archived', deletedAt: new Date() },
      });
    });
    copied += 1;
  }

  console.log(
    `${WRITE ? 'copied' : 'would copy'}: ${copied}, already-migrated: ${skipped}`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
