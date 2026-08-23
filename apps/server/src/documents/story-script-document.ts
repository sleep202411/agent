import {
  Prisma,
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  type StudioDocument,
} from '@prisma/client';
import { encodeDocumentSnapshot } from './document-crdt';
import { rootSchemaFor } from './document-modes';

/**
 * One lock authority for every path that may provision or replace a chapter
 * Script. Keeping the key here prevents the Documents UI and Story workers
 * from each believing they serialized creation while actually locking
 * different advisory namespaces.
 */
export function storyScriptDocumentAdvisoryKey(
  storyProjectId: string,
  storyChapterId: string,
): string {
  return `studio-document:story-script:${storyProjectId}:${storyChapterId}`;
}

export class StoryScriptChapterNotFoundError extends Error {
  constructor() {
    super('The active Story chapter for this Script no longer exists.');
    this.name = 'StoryScriptChapterNotFoundError';
  }
}

export interface EnsuredStoryScriptDocument {
  document: StudioDocument;
  created: boolean;
}

/**
 * Idempotently provision the canonical empty Script identity for one chapter.
 *
 * The caller owns the surrounding transaction. A fresh project/chapter can
 * therefore publish its chapter, layout and Script atomically; legacy paths
 * and the Documents UI use the same advisory lock and converge on one active
 * document under races. The initial version is part of the same transaction,
 * so no caller can observe a half-provisioned Script.
 */
export async function ensureStoryScriptDocumentInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    storyProjectId: string;
    storyChapterId: string;
    actorUserId: string;
  },
): Promise<EnsuredStoryScriptDocument> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${storyScriptDocumentAdvisoryKey(
        input.storyProjectId,
        input.storyChapterId,
      )})::bigint
    )
  `;
  const chapter = await tx.storyChapter.findFirst({
    where: {
      id: input.storyChapterId,
      storyProjectId: input.storyProjectId,
      archivedAt: null,
    },
    select: { title: true },
  });
  if (!chapter) throw new StoryScriptChapterNotFoundError();

  const existing = await tx.studioDocument.findFirst({
    where: {
      storyProjectId: input.storyProjectId,
      storyChapterId: input.storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { document: existing, created: false };

  const rootSchema = rootSchemaFor(StudioDocumentType.script);
  if (!rootSchema) {
    throw new Error('The Story Script CRDT root schema is not registered.');
  }
  const initial = encodeDocumentSnapshot({}, rootSchema);
  const created = await tx.studioDocument.create({
    data: {
      workspaceId: input.workspaceId,
      storyProjectId: input.storyProjectId,
      storyChapterId: input.storyChapterId,
      type: StudioDocumentType.script,
      title: chapter.title,
      contentSnapshot: initial.snapshot as unknown as Prisma.InputJsonValue,
      crdtState: Buffer.from(initial.state),
      createdById: input.actorUserId,
    },
  });
  const version = await tx.studioDocumentVersion.create({
    data: {
      documentId: created.id,
      versionNumber: 1,
      schemaVersion: created.schemaVersion,
      sequence: 0,
      title: created.title,
      source: StudioDocumentVersionSource.system,
      snapshot: created.contentSnapshot as Prisma.InputJsonValue,
      crdtState: created.crdtState,
      metadata: { reason: 'initial_story_chapter_script' },
      createdById: input.actorUserId,
    },
  });
  return {
    document: await tx.studioDocument.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
    }),
    created: true,
  };
}
