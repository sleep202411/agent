import { StudioDocumentType } from '@prisma/client';
import {
  ensureStoryScriptDocumentInTransaction,
  storyScriptDocumentAdvisoryKey,
} from './story-script-document';

const WORKSPACE_ID = '019a0400-0000-7000-8000-000000000001';
const PROJECT_ID = '019a0400-0000-7000-8000-000000000002';
const CHAPTER_ID = '019a0400-0000-7000-8000-000000000003';
const DOCUMENT_ID = '019a0400-0000-7000-8000-000000000004';
const VERSION_ID = '019a0400-0000-7000-8000-000000000005';

describe('chapter Script document provisioning', () => {
  it('uses one chapter-scoped lock authority and is idempotent for legacy callers', async () => {
    let activeDocument: Record<string, unknown> | null = null;
    const createdDocument = {
      id: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      storyProjectId: PROJECT_ID,
      storyChapterId: CHAPTER_ID,
      type: StudioDocumentType.script,
      title: 'Chapter 1',
      schemaVersion: 'studio-document-v1',
      currentSequence: 0,
      currentVersionId: null,
      contentSnapshot: {},
      crdtState: Buffer.from([0, 0]),
    };
    const create = jest.fn().mockImplementation(() => {
      activeDocument = createdDocument;
      return Promise.resolve(createdDocument);
    });
    const update = jest.fn().mockImplementation(() => {
      activeDocument = { ...createdDocument, currentVersionId: VERSION_ID };
      return Promise.resolve(activeDocument);
    });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ title: 'Chapter 1' }),
      },
      studioDocument: {
        findFirst: jest.fn().mockImplementation(() => activeDocument),
        create,
        update,
      },
      studioDocumentVersion: {
        create: jest.fn().mockResolvedValue({ id: VERSION_ID }),
      },
    };
    const input = {
      workspaceId: WORKSPACE_ID,
      storyProjectId: PROJECT_ID,
      storyChapterId: CHAPTER_ID,
      actorUserId: 'creator-1',
    };

    const first = await ensureStoryScriptDocumentInTransaction(
      tx as never,
      input,
    );
    const replay = await ensureStoryScriptDocumentInTransaction(
      tx as never,
      input,
    );

    expect(storyScriptDocumentAdvisoryKey(PROJECT_ID, CHAPTER_ID)).toBe(
      `studio-document:story-script:${PROJECT_ID}:${CHAPTER_ID}`,
    );
    expect(first).toMatchObject({
      created: true,
      document: { id: DOCUMENT_ID, currentVersionId: VERSION_ID },
    });
    expect(replay).toMatchObject({
      created: false,
      document: { id: DOCUMENT_ID, currentVersionId: VERSION_ID },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.studioDocumentVersion.create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
