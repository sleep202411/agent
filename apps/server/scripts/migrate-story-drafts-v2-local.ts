import 'dotenv/config';

import { Prisma } from '@prisma/client';
import { buildPrisma } from '../src/infra/db/db.module';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import {
  LEGACY_INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  migrateInteractiveFilmDraftV1ToV2,
} from '../src/story-studio/interactive-film-draft-v2-migration';
import { INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION } from '../src/story-studio/interactive-film.schema';

async function main(): Promise<void> {
  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    const [drafts, revisions] = await Promise.all([
      prisma.storyDraft.findMany({
        where: { schemaVersion: LEGACY_INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION },
        select: { id: true, content: true },
      }),
      prisma.storyRevision.findMany({
        where: { schemaVersion: LEGACY_INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION },
        select: { id: true, content: true },
      }),
    ]);

    const migratedDrafts = drafts.map((row) => {
      const content = migrateInteractiveFilmDraftV1ToV2(row.content);
      return { id: row.id, content, contentHash: canonicalJsonHash(content) };
    });
    const migratedRevisions = revisions.map((row) => {
      const content = migrateInteractiveFilmDraftV1ToV2(row.content);
      return { id: row.id, content, contentHash: canonicalJsonHash(content) };
    });

    await prisma.$transaction(async (tx) => {
      for (const row of migratedDrafts) {
        await tx.storyDraft.update({
          where: { id: row.id },
          data: {
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content: row.content as Prisma.InputJsonValue,
            contentHash: row.contentHash,
          },
        });
      }
      // Story revisions are immutable to every application write. A storage
      // schema migration is the sole exception: PostgreSQL DDL is transactional,
      // so the trigger is restored atomically and any failure rolls everything
      // back with no window for a partially migrated revision.
      await tx.$executeRawUnsafe(
        'ALTER TABLE "story_revisions" DISABLE TRIGGER "story_revisions_immutable_trg"',
      );
      for (const row of migratedRevisions) {
        await tx.storyRevision.update({
          where: { id: row.id },
          data: {
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content: row.content as Prisma.InputJsonValue,
            contentHash: row.contentHash,
          },
        });
      }
      await tx.$executeRawUnsafe(
        'ALTER TABLE "story_revisions" ENABLE TRIGGER "story_revisions_immutable_trg"',
      );
    });

    console.log(
      `Migrated ${migratedDrafts.length} draft(s) and ${migratedRevisions.length} revision(s) to ${INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
