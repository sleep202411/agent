/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in persistence assertions. */
import { UnprocessableEntityException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaStorageProvider,
  StudioAgentArtifactCleanupStatus,
  StudioAgentArtifactKind,
  StudioAgentArtifactStatus,
} from '@prisma/client';
import { STUDIO_AGENT_SCHEMA_VERSION } from '@repo/shared/studio-agent';
import { StudioAgentArtifactService } from './studio-agent-artifact.service';

const ACTOR_ID = 'actor-1';
const THREAD_ID = '019f8c00-0000-7000-8000-000000000001';
const WORKSPACE_ID = '019f8c00-0000-7000-8000-000000000002';
const PROJECT_ID = '019f8c00-0000-7000-8000-000000000003';
const ASSET_ID = '019f8c00-0000-7000-8000-000000000004';
const ARTIFACT_ID = '019f8c00-0000-7000-8000-000000000005';
const MESSAGE_ID = '019f8c00-0000-7000-8000-000000000006';
const POLICY_ID = '019f8c00-0000-7000-8000-000000000007';
const CLEANUP_TTL_MS = 86_400_000;

function threadRow() {
  const now = new Date('2026-07-24T12:00:00.000Z');
  return {
    id: THREAD_ID,
    workspaceId: WORKSPACE_ID,
    surfaceId: 'story.studio',
    scenarioId: 'story.studio.assistant',
    scenarioVersion: '1.0.0',
    scopeContainer: {
      resourceType: 'story.project',
      resourceId: PROJECT_ID,
      revision: null,
    },
    scopeFocus: null,
    scopeKey: 'a'.repeat(64),
    ownerActorId: ACTOR_ID,
    locale: 'zh-CN',
    title: null,
    status: 'active' as const,
    permissionPolicy: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      policyId: POLICY_ID,
      revision: 1,
      mode: 'ask',
      rules: [],
      createdAt: now.toISOString(),
    },
    activeRunId: null,
    nextMessageOrdinal: 0n,
    nextEventSequence: 1n,
    createdAt: now,
    updatedAt: now,
  };
}

function mediaAsset(
  overrides: Partial<MediaAssetFixture> = {},
): MediaAssetFixture {
  return { ...baseMediaAsset(), ...overrides };
}

interface MediaAssetFixture {
  id: string;
  workspaceId: string;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
  source: MediaAssetSource;
  moderationStatus: MediaAssetModerationStatus;
  storageProvider: MediaStorageProvider;
  objectKey: string;
  contentType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  metadata: Record<string, string>;
  createdByUserId: string;
  deletedAt: Date | null;
}

function baseMediaAsset(): MediaAssetFixture {
  return {
    id: ASSET_ID,
    workspaceId: WORKSPACE_ID,
    kind: MediaAssetKind.image,
    status: MediaAssetStatus.ready,
    source: MediaAssetSource.user_upload,
    moderationStatus:
      MediaAssetModerationStatus.unreviewed as MediaAssetModerationStatus,
    storageProvider: MediaStorageProvider.azure_blob,
    objectKey: `media/global/studio-agent-image-final/${ACTOR_ID}/workspace-${WORKSPACE_ID}/image.png`,
    contentType: 'image/png',
    sizeBytes: 1024n,
    width: 640,
    height: 480,
    checksumSha256: 'a'.repeat(64),
    metadata: { uploadKind: 'studio_agent_image' },
    createdByUserId: ACTOR_ID,
    deletedAt: null,
  };
}

function documentAsset(
  contentType = 'text/markdown',
  extension = 'md',
): MediaAssetFixture {
  return mediaAsset({
    kind: MediaAssetKind.document,
    objectKey: `media/global/studio-agent-document/${ACTOR_ID}/workspace-${WORKSPACE_ID}/document.${extension}`,
    contentType,
    sizeBytes: 7n,
    width: null,
    height: null,
    checksumSha256: null,
    metadata: { uploadKind: 'studio_agent_document' },
  });
}

interface ArtifactFixture {
  id: string;
  threadId: string;
  runId: string | null;
  messageId: string | null;
  actionId: string | null;
  createdByActorId: string;
  kind: StudioAgentArtifactKind;
  status: StudioAgentArtifactStatus;
  cleanupStatus: StudioAgentArtifactCleanupStatus;
  name: string;
  error: Record<string, unknown> | null;
  ingestAttemptCount: number;
}

function baseArtifact(): ArtifactFixture {
  return {
    id: ARTIFACT_ID,
    threadId: THREAD_ID,
    runId: null,
    messageId: null,
    actionId: null,
    createdByActorId: ACTOR_ID,
    kind: StudioAgentArtifactKind.media,
    status: StudioAgentArtifactStatus.ready,
    cleanupStatus: StudioAgentArtifactCleanupStatus.active,
    name: 'reference.png',
    error: null,
    ingestAttemptCount: 0,
  };
}

const config = {
  value: {
    attachmentCleanup: {
      ttlMs: CLEANUP_TTL_MS,
    },
    documentIngest: {
      globalConcurrency: 4,
      maxAttempts: 3,
    },
  },
};

function registrationFixture(options?: {
  asset?: MediaAssetFixture;
  existing?: ArtifactFixture | null;
  projection?: Record<string, unknown>;
  finalizeCount?: number;
  finalizedArtifact?: ArtifactFixture;
}) {
  const createdArtifact = baseArtifact();
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    studioAgentThread: {
      findFirst: jest.fn().mockResolvedValue({
        id: THREAD_ID,
        workspaceId: WORKSPACE_ID,
        scenarioId: 'story.studio.assistant',
      }),
    },
    mediaAsset: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options?.asset ?? baseMediaAsset()),
    },
    studioAgentArtifact: {
      findUnique: jest.fn().mockResolvedValue(options?.existing ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...createdArtifact, ...data, id: ARTIFACT_ID }),
      ),
    },
  };
  const prisma = {
    studioAgentThread: { findFirst: jest.fn().mockResolvedValue(threadRow()) },
    studioAgentArtifact: {
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options?.finalizeCount ?? 1 }),
      findUnique: jest
        .fn()
        .mockResolvedValue(options?.finalizedArtifact ?? createdArtifact),
    },
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const scopes = { authorize: jest.fn().mockResolvedValue({}) };
  const documents = {
    extract: jest.fn().mockResolvedValue(options?.projection),
  };
  return {
    tx,
    prisma,
    scopes,
    service: new StudioAgentArtifactService(
      prisma as never,
      scopes as never,
      config as never,
      documents as never,
    ),
    documents,
  };
}

describe('StudioAgentArtifactService', () => {
  it('registers a confirmed, server-probed Studio Agent image', async () => {
    const fixture = registrationFixture();

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'reference.png',
      }),
    ).resolves.toEqual({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      attachment: {
        type: 'attachment',
        attachmentId: ARTIFACT_ID,
        fileName: 'reference.png',
        mediaType: 'image/png',
        sizeBytes: 1024,
        status: 'ready',
      },
      created: true,
    });

    expect(fixture.scopes.authorize).toHaveBeenCalledTimes(1);
    expect(fixture.tx.studioAgentArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: THREAD_ID,
          createdByActorId: ACTOR_ID,
          mediaAssetId: ASSET_ID,
          kind: StudioAgentArtifactKind.media,
          status: StudioAgentArtifactStatus.ready,
          cleanupStatus: StudioAgentArtifactCleanupStatus.active,
          cleanupExpiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it('returns the canonical existing artifact under concurrent-safe identity', async () => {
    const fixture = registrationFixture({ existing: baseArtifact() });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'ignored-new-name.png',
      }),
    ).resolves.toMatchObject({
      attachment: { fileName: 'reference.png' },
      created: false,
    });
    expect(fixture.tx.studioAgentArtifact.create).not.toHaveBeenCalled();
  });

  it('stores a server-sniffed document projection without copying its bytes', async () => {
    const projection = {
      schemaVersion: 1,
      mediaType: 'text/markdown',
      text: '# Story',
      charCount: 7,
      pageCount: null,
      source: {
        byteCount: 7,
        sha256: 'b'.repeat(64),
        sniffed: true,
      },
    };
    const fixture = registrationFixture({
      asset: mediaAsset({
        kind: MediaAssetKind.document,
        objectKey: `media/global/studio-agent-document/${ACTOR_ID}/workspace-${WORKSPACE_ID}/document.md`,
        contentType: 'text/markdown',
        sizeBytes: 7n,
        width: null,
        height: null,
        checksumSha256: null,
        metadata: { uploadKind: 'studio_agent_document' },
      }),
      projection,
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'outline.md',
      }),
    ).resolves.toMatchObject({
      attachment: {
        fileName: 'outline.md',
        mediaType: 'text/markdown',
        status: 'ready',
      },
      created: true,
    });
    expect(fixture.documents.extract).toHaveBeenCalledTimes(1);
    expect(fixture.tx.studioAgentArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: StudioAgentArtifactKind.document,
          status: StudioAgentArtifactStatus.pending,
          value: expect.anything(),
          contentHash: null,
        }),
      }),
    );
    expect(fixture.prisma.studioAgentArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: ARTIFACT_ID,
        status: StudioAgentArtifactStatus.pending,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: expect.objectContaining({
        status: StudioAgentArtifactStatus.ready,
        value: projection,
        contentHash: 'b'.repeat(64),
        readyAt: expect.any(Date),
      }),
    });
  });

  it('returns processing to a concurrent duplicate without parsing twice', async () => {
    const projection = {
      schemaVersion: 1,
      mediaType: 'text/markdown',
      text: '# Story',
      charCount: 7,
      pageCount: null,
      source: {
        byteCount: 7,
        sha256: 'b'.repeat(64),
        sniffed: true,
      },
    };
    let finishExtraction!: (value: typeof projection) => void;
    const extraction = new Promise<typeof projection>((resolve) => {
      finishExtraction = resolve;
    });
    const fixture = registrationFixture({ asset: documentAsset() });
    fixture.tx.studioAgentArtifact.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseArtifact(),
        kind: StudioAgentArtifactKind.document,
        status: StudioAgentArtifactStatus.pending,
        name: 'outline.md',
      });
    fixture.documents.extract.mockReturnValueOnce(extraction);
    const request = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      mediaAssetId: ASSET_ID,
      fileName: 'outline.md',
    } as const;

    const first = fixture.service.register(
      { userId: ACTOR_ID },
      THREAD_ID,
      request,
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, request),
    ).resolves.toMatchObject({
      attachment: { status: 'processing' },
      created: false,
    });
    expect(fixture.documents.extract).toHaveBeenCalledTimes(1);

    finishExtraction(projection);
    await expect(first).resolves.toMatchObject({
      attachment: { status: 'ready' },
      created: true,
    });
  });

  it('uses a pending-status CAS and returns the canonical winner when finalization loses', async () => {
    const projection = {
      schemaVersion: 1,
      mediaType: 'text/markdown',
      text: '# Story',
      charCount: 7,
      pageCount: null,
      source: {
        byteCount: 7,
        sha256: 'b'.repeat(64),
        sniffed: true,
      },
    };
    const fixture = registrationFixture({
      asset: documentAsset(),
      projection,
      finalizeCount: 0,
      finalizedArtifact: {
        ...baseArtifact(),
        kind: StudioAgentArtifactKind.document,
        status: StudioAgentArtifactStatus.ready,
        name: 'outline.md',
      },
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'outline.md',
      }),
    ).resolves.toMatchObject({
      attachment: { status: 'ready', fileName: 'outline.md' },
      created: false,
    });
    expect(fixture.prisma.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ARTIFACT_ID,
          status: StudioAgentArtifactStatus.pending,
        }),
      }),
    );
    expect(fixture.prisma.studioAgentArtifact.findUnique).toHaveBeenCalledTimes(
      1,
    );
  });

  it('persists a visible failed parsing state before surfacing the parser error', async () => {
    const fixture = registrationFixture({
      asset: mediaAsset({
        kind: MediaAssetKind.document,
        objectKey: `media/global/studio-agent-document/${ACTOR_ID}/workspace-${WORKSPACE_ID}/document.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 100n,
        width: null,
        height: null,
        checksumSha256: null,
        metadata: { uploadKind: 'studio_agent_document' },
      }),
    });
    const parsingError = new UnprocessableEntityException({
      code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
      message: 'The PDF is malformed.',
    });
    fixture.documents.extract.mockRejectedValueOnce(parsingError);

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'broken.pdf',
      }),
    ).rejects.toBe(parsingError);
    expect(fixture.prisma.studioAgentArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: ARTIFACT_ID,
        status: StudioAgentArtifactStatus.pending,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: expect.objectContaining({
        status: StudioAgentArtifactStatus.failed,
        readyAt: null,
        error: expect.objectContaining({
          code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
          message: 'The PDF is malformed.',
          retryable: false,
        }),
      }),
    });
  });

  it('does not retry a deterministic persisted document failure', async () => {
    const fixture = registrationFixture({
      asset: documentAsset('application/pdf', 'pdf'),
      existing: {
        ...baseArtifact(),
        kind: StudioAgentArtifactKind.document,
        status: StudioAgentArtifactStatus.failed,
        name: 'broken.pdf',
        error: {
          code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
          message: 'The PDF is malformed.',
          retryable: false,
          details: null,
        },
      },
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'broken.pdf',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
        message: 'The PDF is malformed.',
        retryable: false,
      },
    });
    expect(fixture.documents.extract).not.toHaveBeenCalled();
    expect(fixture.tx.studioAgentArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('reclaims and retries a transient persisted document failure once', async () => {
    const projection = {
      schemaVersion: 1,
      mediaType: 'application/pdf',
      text: 'Recovered.',
      charCount: 10,
      pageCount: 1,
      source: {
        byteCount: 7,
        sha256: 'c'.repeat(64),
        sniffed: true,
      },
    };
    const fixture = registrationFixture({
      asset: documentAsset('application/pdf', 'pdf'),
      projection,
      existing: {
        ...baseArtifact(),
        kind: StudioAgentArtifactKind.document,
        status: StudioAgentArtifactStatus.failed,
        name: 'retry.pdf',
        error: {
          code: 'STUDIO_AGENT_DOCUMENT_STORAGE_UNAVAILABLE',
          message: 'Document storage is temporarily unavailable.',
          retryable: true,
          details: null,
        },
      },
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'ignored.pdf',
      }),
    ).resolves.toMatchObject({
      attachment: { status: 'ready', fileName: 'retry.pdf' },
      created: false,
    });
    expect(fixture.tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: ARTIFACT_ID,
        status: StudioAgentArtifactStatus.failed,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: expect.objectContaining({
        status: StudioAgentArtifactStatus.pending,
        error: expect.anything(),
      }),
    });
    expect(fixture.documents.extract).toHaveBeenCalledTimes(1);
  });

  it('stops retrying a poison document after the attempt ceiling', async () => {
    const fixture = registrationFixture({
      asset: documentAsset('application/pdf', 'pdf'),
      existing: {
        ...baseArtifact(),
        kind: StudioAgentArtifactKind.document,
        status: StudioAgentArtifactStatus.failed,
        name: 'poison.pdf',
        // Still "retryable" per the parser, but it has already burned every
        // permitted attempt (maxAttempts = 3 in the test config).
        ingestAttemptCount: 3,
        error: {
          code: 'STUDIO_AGENT_DOCUMENT_PARSER_UNAVAILABLE',
          message: 'The document parser crashed.',
          retryable: true,
          details: null,
        },
      },
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'ignored.pdf',
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DOCUMENT_PARSER_UNAVAILABLE' },
    });
    // No reclaim, no fresh parse — the poison document is fully fenced off.
    expect(fixture.tx.studioAgentArtifact.updateMany).not.toHaveBeenCalled();
    expect(fixture.documents.extract).not.toHaveBeenCalled();
  });

  it.each([
    MediaAssetModerationStatus.flagged,
    MediaAssetModerationStatus.blocked,
  ])('rejects %s media safety outcomes', async (moderationStatus) => {
    const fixture = registrationFixture({
      asset: mediaAsset({ moderationStatus }),
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'reference.png',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STUDIO_AGENT_ATTACHMENT_ASSET_MODERATION_RESTRICTED',
      },
    });
  });

  it('rejects an image that did not traverse the dedicated byte-probed upload channel', async () => {
    const fixture = registrationFixture({
      asset: mediaAsset({ metadata: { uploadKind: 'ai_reference_image' } }),
    });

    await expect(
      fixture.service.register({ userId: ACTOR_ID }, THREAD_ID, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: ASSET_ID,
        fileName: 'reference.png',
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_ATTACHMENT_ASSET_UNSUPPORTED' },
    });
  });

  it('atomically binds exact canonical attachment metadata to one user message', async () => {
    const service = new StudioAgentArtifactService(
      {} as never,
      {} as never,
      config as never,
      {} as never,
    );
    const tx = bindingTransaction();

    await service.bindMessageAttachmentsInTransaction(tx as never, {
      actorId: ACTOR_ID,
      threadId: THREAD_ID,
      messageId: MESSAGE_ID,
      parts: [
        {
          type: 'attachment',
          attachmentId: ARTIFACT_ID,
          fileName: 'reference.png',
          mediaType: 'image/png',
          sizeBytes: 1024,
          status: 'ready',
        },
      ],
    });

    expect(tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        threadId: THREAD_ID,
        id: { in: [ARTIFACT_ID] },
        messageId: null,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: {
        messageId: MESSAGE_ID,
        cleanupExpiresAt: null,
      },
    });
  });

  it('rejects client-forged attachment metadata before binding', async () => {
    const service = new StudioAgentArtifactService(
      {} as never,
      {} as never,
      config as never,
      {} as never,
    );
    const tx = bindingTransaction();

    await expect(
      service.bindMessageAttachmentsInTransaction(tx as never, {
        actorId: ACTOR_ID,
        threadId: THREAD_ID,
        messageId: MESSAGE_ID,
        parts: [
          {
            type: 'attachment',
            attachmentId: ARTIFACT_ID,
            fileName: 'renamed-by-client.png',
            mediaType: 'image/png',
            sizeBytes: 1024,
            status: 'ready',
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_ATTACHMENT_METADATA_MISMATCH' },
    });
    expect(tx.studioAgentArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('durably schedules an actor-owned unbound attachment for cleanup', async () => {
    const fixture = deletionFixture();

    await expect(
      fixture.service.deleteUnbound(
        { userId: ACTOR_ID },
        THREAD_ID,
        ARTIFACT_ID,
      ),
    ).resolves.toEqual({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      attachmentId: ARTIFACT_ID,
      cleanupStatus: 'scheduled',
    });
    expect(fixture.tx.studioAgentArtifact.update).toHaveBeenCalledWith({
      where: { id: ARTIFACT_ID },
      data: expect.objectContaining({
        cleanupStatus: StudioAgentArtifactCleanupStatus.scheduled,
        cleanupReason: 'user_abandoned',
        cleanupRequestedAt: expect.any(Date),
        cleanupNextAttemptAt: expect.any(Date),
      }),
    });
  });

  it('never schedules a message-bound attachment for cleanup', async () => {
    const fixture = deletionFixture({ messageId: MESSAGE_ID });

    await expect(
      fixture.service.deleteUnbound(
        { userId: ACTOR_ID },
        THREAD_ID,
        ARTIFACT_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_ATTACHMENT_ALREADY_BOUND' },
    });
    expect(fixture.tx.studioAgentArtifact.update).not.toHaveBeenCalled();
  });

  it('never schedules a run-bound artifact for cleanup', async () => {
    const fixture = deletionFixture({
      runId: '019f8c00-0000-7000-8000-000000000010',
    });

    await expect(
      fixture.service.deleteUnbound(
        { userId: ACTOR_ID },
        THREAD_ID,
        ARTIFACT_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_ATTACHMENT_ALREADY_BOUND' },
    });
    expect(fixture.tx.studioAgentArtifact.update).not.toHaveBeenCalled();
  });

  it('is idempotent after attachment cleanup completed', async () => {
    const fixture = deletionFixture({
      cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
    });

    await expect(
      fixture.service.deleteUnbound(
        { userId: ACTOR_ID },
        THREAD_ID,
        ARTIFACT_ID,
      ),
    ).resolves.toMatchObject({ cleanupStatus: 'cleaned' });
    expect(fixture.tx.studioAgentArtifact.update).not.toHaveBeenCalled();
  });
});

function deletionFixture(
  overrides: Partial<
    Omit<
      ReturnType<typeof baseArtifact>,
      'runId' | 'messageId' | 'actionId' | 'cleanupStatus'
    >
  > & {
    runId?: string | null;
    messageId?: string | null;
    actionId?: string | null;
    cleanupStatus?: StudioAgentArtifactCleanupStatus;
  } = {},
) {
  const artifact = { ...baseArtifact(), ...overrides };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ARTIFACT_ID }]),
    studioAgentArtifact: {
      findFirst: jest.fn().mockResolvedValue(artifact),
      update: jest.fn().mockResolvedValue(artifact),
    },
  };
  const prisma = {
    studioAgentThread: { findFirst: jest.fn().mockResolvedValue(threadRow()) },
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const scopes = { authorize: jest.fn().mockResolvedValue({}) };
  return {
    tx,
    service: new StudioAgentArtifactService(
      prisma as never,
      scopes as never,
      config as never,
      {} as never,
    ),
  };
}

function bindingTransaction() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ARTIFACT_ID }]),
    studioAgentThread: {
      findFirst: jest.fn().mockResolvedValue({
        id: THREAD_ID,
        workspaceId: WORKSPACE_ID,
        scenarioId: 'story.studio.assistant',
      }),
    },
    studioAgentMessage: {
      findFirst: jest.fn().mockResolvedValue({ id: MESSAGE_ID }),
    },
    studioAgentArtifact: {
      findMany: jest.fn().mockResolvedValue([
        {
          ...baseArtifact(),
          mediaAsset: baseMediaAsset(),
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
