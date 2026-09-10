import {
  Prisma,
  StudioDocumentOperationType,
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  type StudioDocumentOperation,
} from '@prisma/client';
import {
  StoryScreenplayDocumentSchema,
  StoryScreenplaySchema,
  type StoryScreenplay,
  type StoryScreenplayDocument,
} from '@repo/shared/story-agent';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { storyScriptDocumentAdvisoryKey } from '../documents/story-script-document';
import { canonicalJsonHash } from './canonical-json';

export interface StoryScriptHead {
  documentId: string | null;
  sequence: number;
  hash: string;
  /** True only when the collaborative Script contains creator-visible nodes. */
  hasContent: boolean;
}

export interface StoryScriptCommit {
  documentId: string;
  sequence: number;
  hash: string;
  versionId: string;
  operation: StudioDocumentOperation;
}

export interface ApprovedStoryScreenplaySnapshot {
  documentId: string;
  versionId: string;
  sequence: number;
  screenplay: StoryScreenplay;
  document: StoryScreenplayDocument;
}

export interface StoryScriptSourceSnapshot extends StoryScriptHead {
  /** Exact current Y.XmlFragment serialization used only as model source. */
  sourceText: string;
}

export interface DerivedStoryScreenplayLineage {
  documentId: string;
  versionId: string;
  sequence: number;
  hash: string;
}

const EMPTY_SCRIPT_HASH = canonicalJsonHash({ state: null, sequence: 0 });

export async function readStoryScriptHead(
  tx: Prisma.TransactionClient,
  storyProjectId: string,
  storyChapterId: string,
): Promise<StoryScriptHead> {
  const document = await tx.studioDocument.findFirst({
    where: {
      storyProjectId,
      storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!document)
    return {
      documentId: null,
      sequence: 0,
      hash: EMPTY_SCRIPT_HASH,
      hasContent: false,
    };
  const operations = await unappliedScriptOperations(tx, document);
  const doc = hydrateScript(document.crdtState, operations);
  try {
    return {
      documentId: document.id,
      sequence: document.currentSequence,
      hash: hashScript(doc),
      hasContent: doc.getXmlFragment('content').length > 0,
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Read the current creator-authored Script without interpreting or rewriting
 * it. The XML serialization preserves headings/paragraph boundaries and is
 * pinned by the same CRDT hash returned with the source.
 */
export async function readStoryScriptSourceSnapshot(
  tx: Prisma.TransactionClient,
  storyProjectId: string,
  storyChapterId: string,
): Promise<StoryScriptSourceSnapshot | null> {
  const document = await tx.studioDocument.findFirst({
    where: {
      storyProjectId,
      storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!document) return null;
  const operations = await unappliedScriptOperations(tx, document);
  const doc = hydrateScript(document.crdtState, operations);
  try {
    const content = doc.getXmlFragment('content');
    if (content.length === 0) return null;
    const sourceText = content.toJSON().trim();
    if (!sourceText) return null;
    return {
      documentId: document.id,
      sequence: document.currentSequence,
      hash: hashScript(doc),
      hasContent: true,
      sourceText,
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Read the structured screenplay snapshot attached to the exact current Script
 * head, independently of Plot Tree lineage. Script approval advances this head;
 * Plot approval later binds the chapter's sourceScript* tuple to the same
 * version. A creator edit after approval advances the CRDT sequence without a
 * matching structured version and therefore returns null.
 */
export async function readCurrentStoryScreenplaySnapshot(
  tx: Prisma.TransactionClient,
  storyProjectId: string,
  storyChapterId: string,
): Promise<ApprovedStoryScreenplaySnapshot | null> {
  const document = await tx.studioDocument.findFirst({
    where: {
      storyProjectId,
      storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      currentSequence: true,
      currentVersionId: true,
    },
  });
  if (!document?.currentVersionId) return null;
  const version = await tx.studioDocumentVersion.findFirst({
    where: {
      id: document.currentVersionId,
      documentId: document.id,
      sequence: document.currentSequence,
    },
    select: { id: true, documentId: true, sequence: true, snapshot: true },
  });
  if (!version || !isJsonRecord(version.snapshot)) return null;
  const screenplay = StoryScreenplaySchema.safeParse(
    version.snapshot.screenplay,
  );
  const screenplayDocument = StoryScreenplayDocumentSchema.safeParse(
    version.snapshot.document,
  );
  if (!screenplay.success || !screenplayDocument.success) return null;
  return {
    documentId: version.documentId,
    versionId: version.id,
    sequence: version.sequence,
    screenplay: screenplay.data,
    document: screenplayDocument.data,
  };
}

/**
 * Persist only a structured interpretation of an existing Script head. This
 * creates a restorable version of the exact current CRDT state and binds the
 * chapter lineage to it; it never appends a document operation, changes the
 * Script sequence, or replaces creator-visible text.
 */
export async function commitDerivedStoryScreenplaySnapshot(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    storyProjectId: string;
    storyChapterId: string;
    actorUserId: string;
    screenplay: StoryScreenplay;
    document: StoryScreenplayDocument;
    expected: Pick<StoryScriptHead, 'documentId' | 'sequence' | 'hash'>;
  },
): Promise<DerivedStoryScreenplayLineage> {
  if (!input.expected.documentId) throw new StoryScriptBaseChangedError();
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${storyScriptDocumentAdvisoryKey(
        input.storyProjectId,
        input.storyChapterId,
      )})::bigint
    )
  `;
  const source = await tx.studioDocument.findFirst({
    where: {
      id: input.expected.documentId,
      storyProjectId: input.storyProjectId,
      storyChapterId: input.storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
  });
  if (!source) throw new StoryScriptBaseChangedError();
  const operations = await unappliedScriptOperations(tx, source);
  const doc = hydrateScript(source.crdtState, operations);
  try {
    const hash = hashScript(doc);
    if (
      source.currentSequence !== input.expected.sequence ||
      hash !== input.expected.hash
    ) {
      throw new StoryScriptBaseChangedError();
    }
    const previous = await tx.studioDocumentVersion.findFirst({
      where: { documentId: source.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const version = await tx.studioDocumentVersion.create({
      data: {
        documentId: source.id,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        schemaVersion: source.schemaVersion,
        sequence: source.currentSequence,
        title: source.title,
        label: 'Derived Story structure',
        source: StudioDocumentVersionSource.system,
        sourceId: input.runId,
        snapshot: screenplaySnapshot(input.screenplay, input.document),
        crdtState: Buffer.from(Y.encodeStateAsUpdate(doc)),
        metadata: {
          kind: 'story-screenplay-derivation',
          sourceScriptHash: hash,
        },
        createdById: input.actorUserId,
      },
    });
    await tx.studioDocument.update({
      where: { id: source.id },
      data: { currentVersionId: version.id },
    });
    return {
      documentId: source.id,
      versionId: version.id,
      sequence: source.currentSequence,
      hash,
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Persist the approved screenplay as the authoritative collaborative Script.
 * This is an intentional durable stage boundary: the caller commits only the
 * exact creator-seen Script. A later explicit Story run may propose Plot from
 * that committed head; Script approval never binds chapter Plot lineage.
 */
export async function commitApprovedScreenplay(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    workspaceId: string;
    storyProjectId: string;
    storyChapterId: string;
    actorUserId: string;
    screenplay: StoryScreenplay;
    document: StoryScreenplayDocument;
    expected: Pick<StoryScriptHead, 'documentId' | 'sequence' | 'hash'>;
  },
): Promise<StoryScriptCommit> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${storyScriptDocumentAdvisoryKey(
        input.storyProjectId,
        input.storyChapterId,
      )})::bigint
    )
  `;
  let document = await tx.studioDocument.findFirst({
    where: {
      storyProjectId: input.storyProjectId,
      storyChapterId: input.storyChapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  const createdForCommit = document === null;
  if (!document) {
    if (
      input.expected.documentId !== null ||
      input.expected.sequence !== 0 ||
      input.expected.hash !== EMPTY_SCRIPT_HASH
    ) {
      throw new StoryScriptBaseChangedError();
    }
    const empty = new Y.Doc({ gc: true });
    empty.getMap('meta');
    empty.getXmlFragment('content');
    const state = Buffer.from(Y.encodeStateAsUpdate(empty));
    empty.destroy();
    const created = await tx.studioDocument.create({
      data: {
        workspaceId: input.workspaceId,
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
        type: StudioDocumentType.script,
        title: input.screenplay.title,
        contentSnapshot: {},
        crdtState: state,
        createdById: input.actorUserId,
      },
    });
    document = created;
  }

  const operations = await unappliedScriptOperations(tx, document);
  const current = hydrateScript(document.crdtState, operations);
  try {
    if (
      !createdForCommit &&
      (input.expected.documentId !== document.id ||
        input.expected.sequence !== document.currentSequence ||
        input.expected.hash !== hashScript(current))
    ) {
      throw new StoryScriptBaseChangedError();
    }

    const stateVector = Y.encodeStateVector(current);
    replaceScriptContent(current, input.screenplay, input.document);
    const update = Y.encodeStateAsUpdate(current, stateVector);
    const fullState = Y.encodeStateAsUpdate(current);
    const sequence = document.currentSequence + 1;
    const latestVersion = await tx.studioDocumentVersion.aggregate({
      where: { documentId: document.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (latestVersion._max.versionNumber ?? 0) + 1;
    const operation = await tx.studioDocumentOperation.create({
      data: {
        documentId: document.id,
        sequence,
        operationType: StudioDocumentOperationType.yjs_update,
        actorUserId: input.actorUserId,
        idempotencyKey: `story-screenplay:${input.runId}`,
        baseSequence: document.currentSequence,
        yjsUpdate: Buffer.from(update),
        metadata: {
          source: 'story_agent_screenplay',
          storyAgentRunId: input.runId,
          screenplaySchemaVersion: input.screenplay.schemaVersion,
          screenplayDocumentSchemaVersion: input.document.schemaVersion,
        },
      },
    });
    const version = await tx.studioDocumentVersion.create({
      data: {
        documentId: document.id,
        versionNumber,
        schemaVersion: document.schemaVersion,
        sequence,
        title: input.screenplay.title,
        label: 'Approved screenplay',
        source: StudioDocumentVersionSource.ai,
        sourceId: input.runId,
        snapshot: screenplaySnapshot(input.screenplay, input.document),
        crdtState: Buffer.from(fullState),
        metadata: {
          storyAgentRunId: input.runId,
          screenplaySchemaVersion: input.screenplay.schemaVersion,
          screenplayDocumentSchemaVersion: input.document.schemaVersion,
        },
        createdById: input.actorUserId,
      },
    });
    await tx.studioDocument.update({
      where: { id: document.id },
      data: {
        title: input.screenplay.title,
        currentSequence: sequence,
        currentVersionId: version.id,
        updatedById: input.actorUserId,
        version: versionNumber,
      },
    });
    return {
      documentId: document.id,
      versionId: version.id,
      sequence,
      hash: hashScript(current),
      operation,
    };
  } finally {
    current.destroy();
  }
}

export class StoryScriptBaseChangedError extends Error {
  constructor() {
    super(
      'The collaborative Script changed after this screenplay was drafted.',
    );
    this.name = 'StoryScriptBaseChangedError';
  }
}

function hydrateScript(
  base: Uint8Array | null,
  operations: ReadonlyArray<{ yjsUpdate: Uint8Array | null }>,
): Y.Doc {
  const doc = new Y.Doc({ gc: true });
  doc.getMap('meta');
  doc.getXmlFragment('content');
  if (base?.byteLength) Y.applyUpdate(doc, base);
  for (const operation of operations) {
    if (operation.yjsUpdate?.byteLength)
      Y.applyUpdate(doc, operation.yjsUpdate);
  }
  return doc;
}

async function unappliedScriptOperations(
  tx: Prisma.TransactionClient,
  document: { id: string; snapshotSequence: number },
): Promise<Array<{ yjsUpdate: Uint8Array | null }>> {
  return tx.studioDocumentOperation.findMany({
    where: {
      documentId: document.id,
      operationType: StudioDocumentOperationType.yjs_update,
      sequence: { gt: document.snapshotSequence },
    },
    orderBy: { sequence: 'asc' },
    select: { yjsUpdate: true },
  });
}

function hashScript(doc: Y.Doc): string {
  return createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
}

function replaceScriptContent(
  doc: Y.Doc,
  screenplay: StoryScreenplay,
  document: StoryScreenplayDocument,
): void {
  const root = doc.getXmlFragment('content');
  doc.transact(() => {
    if (root.length > 0) root.delete(0, root.length);
    root.insert(0, documentNodes(document));
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', screenplay.schemaVersion);
    meta.set('documentSchemaVersion', document.schemaVersion);
    meta.set('title', screenplay.title);
  }, 'story-agent-screenplay');
}

function documentNodes(document: StoryScreenplayDocument): Y.XmlElement[] {
  return document.blocks.map((block) =>
    block.kind === 'heading'
      ? element('heading', block.text, { level: block.level })
      : element('paragraph', block.text),
  );
}

function element(
  nodeName: string,
  text: string,
  attributes?: Record<string, string | number>,
): Y.XmlElement {
  const node = new Y.XmlElement(nodeName);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    // y-prosemirror writes ProseMirror attributes verbatim (heading `level`
    // is numeric), while Yjs' public TypeScript declaration is narrower than
    // its runtime API. Preserve the schema value instead of stringifying it.
    node.setAttribute(name, value as unknown as string);
  }
  const content = new Y.XmlText();
  content.insert(0, text);
  node.insert(0, [content]);
  return node;
}

function screenplaySnapshot(
  screenplay: StoryScreenplay,
  document: StoryScreenplayDocument,
): Prisma.InputJsonObject {
  return JSON.parse(
    JSON.stringify({ screenplay, document }),
  ) as Prisma.InputJsonObject;
}

function isJsonRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
