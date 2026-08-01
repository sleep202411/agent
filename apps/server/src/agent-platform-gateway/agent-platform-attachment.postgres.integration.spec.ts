import {
  AgentPlatformAttachmentIngestJobStatus,
  AgentPlatformAttachmentStatus,
  AgentPlatformPermissionMode,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  type PrismaClient,
} from '@prisma/client';
import {
  HttpException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { buildStorySourceMaterialIndex } from '../agent-domain-gateway/story-source-material-index';
import { buildPrisma } from '../infra/db/db.module';
import { AgentPlatformAttachmentIngestService } from './agent-platform-attachment-ingest.service';
import { AgentPlatformAttachmentParser } from './agent-platform-attachment-parser';
import { AgentPlatformAttachmentService } from './agent-platform-attachment.service';
import { AgentPlatformDocumentAnalysisService } from './agent-platform-document-analysis.service';

const describePostgres =
  process.env.AGENT_PLATFORM_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;
const ACTOR_ID = 'agent-platform-attachment-integration';

describePostgres('Agent Platform attachment PostgreSQL boundary', () => {
  let prisma: PrismaClient;
  let conversationId: string;
  let conversations: { authorizeExisting: jest.Mock };
  let storage: { createReadUrl: jest.Mock };
  let parser: jest.Mocked<Pick<AgentPlatformAttachmentParser, 'ingest'>>;
  let analysisDispatcher: { wake: jest.Mock };
  let registrationWake: { wake: jest.Mock };
  let ingest: AgentPlatformAttachmentIngestService;
  let service: AgentPlatformAttachmentService;
  let documentAnalysis: AgentPlatformDocumentAnalysisService;

  beforeAll(async () => {
    prisma = buildPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    conversationId = randomUUID();
    await prisma.agentPlatformConversation.create({
      data: {
        id: conversationId,
        ownerActorId: ACTOR_ID,
        surface: 'crew-management',
        scopeKind: 'crew',
        scopeKey: createHash('sha256')
          .update('crew:attachment-integration-crew')
          .digest('hex'),
        scope: { kind: 'crew', crewId: 'attachment-integration-crew' },
        permissionMode: AgentPlatformPermissionMode.smart,
      },
    });
    const authorized = {
      conversation: {
        id: conversationId,
        surface: 'crew-management',
        title: null,
        permissionMode: 'smart',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      },
      context: {
        actorId: ACTOR_ID,
        actorDisplayName: 'Attachment Integration',
        conversationId,
        surface: 'crew-management',
        scope: { kind: 'crew', crewId: 'attachment-integration-crew' },
        sessionName: `agent:v1:conversation:${conversationId}`,
        permissionMode: 'smart',
        locale: 'en-GB',
        roles: ['crew.admin'],
        permissions: ['crew.read'],
        traceId: randomUUID(),
      },
    };
    conversations = {
      authorizeExisting: jest.fn().mockResolvedValue(authorized),
    };
    storage = {
      createReadUrl: jest.fn(),
    };
    parser = {
      ingest: jest.fn<
        ReturnType<AgentPlatformAttachmentParser['ingest']>,
        Parameters<AgentPlatformAttachmentParser['ingest']>
      >(),
    };
    analysisDispatcher = {
      wake: jest.fn().mockResolvedValue(undefined),
    };
    registrationWake = {
      wake: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      values: {
        attachmentProcessingLeaseMs: 90_000,
        attachmentProcessingMaxAttempts: 3,
        attachmentIngestIntervalMs: 60_000,
        attachmentIngestBatchSize: 4,
      },
    };
    ingest = new AgentPlatformAttachmentIngestService(
      prisma as never,
      storage as never,
      parser as never,
      analysisDispatcher as never,
      config as never,
    );
    service = new AgentPlatformAttachmentService(
      prisma as never,
      conversations as never,
      storage as never,
      registrationWake as never,
      config as never,
    );
    documentAnalysis = new AgentPlatformDocumentAnalysisService(
      prisma as never,
    );
  });

  afterEach(async () => {
    await ingest.onModuleDestroy();
    jest.restoreAllMocks();
    await cleanup();
  });

  it('converges concurrent image registration on one ready identity', async () => {
    const mediaAssetId = await createImageAsset();
    const request = {
      schemaVersion: 'agent-attachment-register/v1' as const,
      conversationId,
      mediaAssetId,
      fileName: 'reference.png',
      locale: 'en-GB',
    };

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.register({ userId: ACTOR_ID }, request),
      ),
    );

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.every((result) => result.status === 'ready')).toBe(true);
    await expect(
      prisma.agentPlatformAttachment.count({
        where: { conversationId, mediaAssetId },
      }),
    ).resolves.toBe(1);
  });

  it('returns processing immediately, then leases and atomically finalizes a document', async () => {
    const text = '# Story\n\nA beginning.';
    const bytes = Buffer.from(text, 'utf8');
    const mediaAssetId = await createDocumentAsset({
      mediaType: 'text/markdown',
      fileName: 'story.md',
      bytes,
    });
    mockDocumentReadUrl(mediaAssetId);
    parser.ingest.mockResolvedValue(ingestResult(text, 'story.md'));

    const registered = await service.register(
      { userId: ACTOR_ID },
      {
        schemaVersion: 'agent-attachment-register/v1',
        conversationId,
        mediaAssetId,
        fileName: 'story.md',
        locale: 'en-GB',
      },
    );

    expect(registered).toMatchObject({
      status: 'processing',
      mediaType: 'text/markdown',
      ingest: {
        stage: 'queued',
        progress: 0,
        attempt: 0,
        maximumAttempts: 3,
      },
      analysis: null,
    });
    expect(parser.ingest).not.toHaveBeenCalled();
    expect(registrationWake.wake).toHaveBeenCalledTimes(1);

    await ingest.wake();

    const attachment = await prisma.agentPlatformAttachment.findUniqueOrThrow({
      where: {
        conversationId_mediaAssetId: { conversationId, mediaAssetId },
      },
      select: {
        status: true,
        documentText: true,
        contentHash: true,
        documentIndex: true,
        documentIndexVersion: true,
        ingestJob: {
          select: {
            status: true,
            attemptCount: true,
            leaseToken: true,
            stage: true,
          },
        },
        analysisJobs: {
          select: { status: true, completedUnits: true, totalUnits: true },
        },
      },
    });
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    expect(attachment).toMatchObject({
      status: AgentPlatformAttachmentStatus.ready,
      documentText: text,
      contentHash,
      documentIndexVersion: 'story-source-material-index/v1',
      ingestJob: {
        status: AgentPlatformAttachmentIngestJobStatus.succeeded,
        attemptCount: 1,
        leaseToken: null,
        stage: 'ready',
      },
      analysisJobs: [{ status: 'queued', completedUnits: 0, totalUnits: 2 }],
    });
    expect(attachment.documentIndex).toMatchObject({
      schemaVersion: 'story-source-material-index/v1',
      contentHash,
      document: {
        characterCount: text.length,
        chunkCount: 1,
      },
    });
    expect(parser.ingest).toHaveBeenCalledTimes(1);
    expect(parser.ingest.mock.calls[0]?.[0]).toMatchObject({
      fileName: 'story.md',
      declaredMediaType: 'text/markdown',
      expectedSizeBytes: bytes.length,
    });
    expect(parser.ingest.mock.calls[0]?.[0].downloadUrl).toContain(
      mediaAssetId,
    );
    expect(analysisDispatcher.wake).toHaveBeenCalledTimes(1);
  });

  it('dead-letters a non-retryable extraction failure and never repeats unsafe work', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
    const mediaAssetId = await createDocumentAsset({
      mediaType: 'text/plain',
      fileName: 'invalid.txt',
      bytes,
    });
    mockDocumentReadUrl(mediaAssetId);
    parser.ingest.mockRejectedValue(
      new UnprocessableEntityException({
        code: 'AGENT_ATTACHMENT_DOCUMENT_ENCODING_INVALID',
        message: 'Text attachments must be valid UTF-8.',
        retryable: false,
      }),
    );
    const request = {
      schemaVersion: 'agent-attachment-register/v1' as const,
      conversationId,
      mediaAssetId,
      fileName: 'invalid.txt',
      locale: 'en-GB',
    };

    await expect(
      service.register({ userId: ACTOR_ID }, request),
    ).resolves.toMatchObject({ status: 'processing' });
    await ingest.wake();
    const repeatedError = await captureHttpException(
      service.register({ userId: ACTOR_ID }, request),
    );
    expect(repeatedError.getResponse()).toMatchObject({
      code: 'AGENT_ATTACHMENT_DOCUMENT_ENCODING_INVALID',
      retryable: false,
    });

    expect(parser.ingest).toHaveBeenCalledTimes(1);
    await expect(
      prisma.agentPlatformAttachment.findUniqueOrThrow({
        where: {
          conversationId_mediaAssetId: { conversationId, mediaAssetId },
        },
        select: {
          status: true,
          error: true,
          ingestJob: {
            select: { status: true, attemptCount: true, error: true },
          },
        },
      }),
    ).resolves.toEqual({
      status: AgentPlatformAttachmentStatus.failed,
      error: {
        code: 'AGENT_ATTACHMENT_DOCUMENT_ENCODING_INVALID',
        message: 'Text attachments must be valid UTF-8.',
        retryable: false,
      },
      ingestJob: {
        status: AgentPlatformAttachmentIngestJobStatus.dead_lettered,
        attemptCount: 1,
        error: {
          code: 'AGENT_ATTACHMENT_DOCUMENT_ENCODING_INVALID',
          message: 'Text attachments must be valid UTF-8.',
          retryable: false,
        },
      },
    });
  });

  it('backs off transient extraction failures and stops at the configured limit', async () => {
    const bytes = Buffer.from('temporary parser failure', 'utf8');
    const mediaAssetId = await createDocumentAsset({
      mediaType: 'text/plain',
      fileName: 'retry.txt',
      bytes,
    });
    mockDocumentReadUrl(mediaAssetId);
    parser.ingest.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'AGENT_ATTACHMENT_DOCUMENT_PARSER_CRASHED',
        message: 'The isolated document parser stopped unexpectedly.',
        retryable: true,
      }),
    );
    const registered = await service.register(
      { userId: ACTOR_ID },
      {
        schemaVersion: 'agent-attachment-register/v1',
        conversationId,
        mediaAssetId,
        fileName: 'retry.txt',
        locale: 'en-GB',
      },
    );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await ingest.wake();
      if (attempt < 3) await makeIngestDue(registered.id);
    }

    expect(parser.ingest).toHaveBeenCalledTimes(3);
    await expect(
      prisma.agentPlatformAttachment.findUniqueOrThrow({
        where: { id: registered.id },
        select: {
          status: true,
          error: true,
          ingestJob: {
            select: { status: true, attemptCount: true, error: true },
          },
        },
      }),
    ).resolves.toMatchObject({
      status: AgentPlatformAttachmentStatus.failed,
      error: {
        code: 'AGENT_ATTACHMENT_PROCESSING_EXHAUSTED',
        retryable: true,
      },
      ingestJob: {
        status: AgentPlatformAttachmentIngestJobStatus.dead_lettered,
        attemptCount: 3,
        error: {
          code: 'AGENT_ATTACHMENT_PROCESSING_EXHAUSTED',
          retryable: true,
        },
      },
    });

    await expect(
      service.register(
        { userId: ACTOR_ID },
        {
          schemaVersion: 'agent-attachment-register/v1',
          conversationId,
          mediaAssetId,
          fileName: 'retry.txt',
          locale: 'en-GB',
        },
      ),
    ).resolves.toMatchObject({
      id: registered.id,
      status: 'processing',
      ingest: { attempt: 0, stage: 'queued' },
    });
  });

  it('reclaims an expired lease after a worker crash and creates one analysis job', async () => {
    const text = '# Crash recovery\n\nThe durable worker resumes.';
    const bytes = Buffer.from(text, 'utf8');
    const mediaAssetId = await createDocumentAsset({
      mediaType: 'text/markdown',
      fileName: 'recovery.md',
      bytes,
    });
    mockDocumentReadUrl(mediaAssetId);
    parser.ingest.mockResolvedValue(ingestResult(text, 'recovery.md'));
    const registered = await service.register(
      { userId: ACTOR_ID },
      {
        schemaVersion: 'agent-attachment-register/v1',
        conversationId,
        mediaAssetId,
        fileName: 'recovery.md',
        locale: 'en-GB',
      },
    );
    // Exactly the row `claimDue` commits before it hands the job to a worker,
    // with the lease already expired. Omitting `lastHeartbeatAt` here would
    // write a state the production claim can never produce.
    await prisma.agentPlatformAttachmentIngestJob.update({
      where: { attachmentId: registered.id },
      data: {
        status: AgentPlatformAttachmentIngestJobStatus.leased,
        attemptCount: 1,
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1_000),
        lastHeartbeatAt: new Date(Date.now() - 91_000),
        stage: 'extracting',
      },
    });

    await Promise.all([ingest.wake(), ingest.wake(), ingest.wake()]);

    await expect(
      prisma.agentPlatformAttachmentIngestJob.findUniqueOrThrow({
        where: { attachmentId: registered.id },
        select: { status: true, attemptCount: true, leaseToken: true },
      }),
    ).resolves.toEqual({
      status: AgentPlatformAttachmentIngestJobStatus.succeeded,
      attemptCount: 2,
      leaseToken: null,
    });
    expect(parser.ingest).toHaveBeenCalledTimes(1);
    await expect(
      prisma.agentDocumentAnalysisJob.count({
        where: { attachmentId: registered.id },
      }),
    ).resolves.toBe(1);
  });

  it('returns the immutable checkpoint after a lost response even if model wording changes', async () => {
    const text =
      '# Idempotency\n\nThe same source must produce one durable coordinate.';
    const bytes = Buffer.from(text, 'utf8');
    const mediaAssetId = await createDocumentAsset({
      mediaType: 'text/markdown',
      fileName: 'idempotency.md',
      bytes,
    });
    mockDocumentReadUrl(mediaAssetId);
    parser.ingest.mockResolvedValue(ingestResult(text, 'idempotency.md'));
    const registered = await service.register(
      { userId: ACTOR_ID },
      {
        schemaVersion: 'agent-attachment-register/v1',
        conversationId,
        mediaAssetId,
        fileName: 'idempotency.md',
        locale: 'en-GB',
      },
    );
    await ingest.wake();
    const queued = await prisma.agentDocumentAnalysisJob.findUniqueOrThrow({
      where: {
        attachmentId_analysisVersion_sourceContentHash: {
          attachmentId: registered.id,
          analysisVersion: 'story-document-analysis/v1',
          sourceContentHash: createHash('sha256').update(bytes).digest('hex'),
        },
      },
      select: { id: true },
    });
    // Mirrors the Temporal dispatcher's claim: a `dispatching` job always
    // carries the workflow id it was dispatched under plus its dispatch lease,
    // and `claim()` promotes it to `running` on the strength of that id.
    const job = await prisma.agentDocumentAnalysisJob.update({
      where: { id: queued.id },
      data: {
        status: 'dispatching',
        temporalWorkflowId: `agent-document-analysis:${queued.id}`,
        dispatchAttemptCount: 1,
        dispatchLeaseToken: randomUUID(),
        dispatchLeaseUntil: new Date(Date.now() + 45_000),
        stage: 'dispatching',
      },
    });
    const manifest = await documentAnalysis.claim(job.id);
    const base = {
      schemaVersion: 'agent-long-document-artifact-write/v1' as const,
      jobId: job.id,
      kind: 'section' as const,
      level: 0,
      ordinal: 0,
      sourceChunkIds: [manifest.sections[0].chunkId],
      inputArtifactIds: [],
    };
    const first = await documentAnalysis.writeArtifact({
      ...base,
      content: sectionAnalysis(
        manifest.sections[0].chunkId,
        'First durable wording.',
      ),
    });
    const responseLostRetry = await documentAnalysis.writeArtifact({
      ...base,
      content: sectionAnalysis(
        manifest.sections[0].chunkId,
        'Different non-deterministic retry wording.',
      ),
    });

    expect(responseLostRetry).toEqual(first);
    await expect(
      prisma.agentDocumentAnalysisArtifact.count({
        where: { jobId: job.id, kind: 'section', level: 0, ordinal: 0 },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.agentDocumentAnalysisArtifact.findUniqueOrThrow({
        where: { id: first.artifactId },
        select: { content: true },
      }),
    ).resolves.toMatchObject({
      content: { summary: 'First durable wording.' },
    });
  });

  it('re-authorizes, preserves request order, and mints image URLs just in time', async () => {
    const firstAssetId = await createImageAsset();
    const secondAssetId = await createImageAsset();
    const first = await registerImage(firstAssetId, 'first.png');
    const second = await registerImage(secondAssetId, 'second.png');
    storage.createReadUrl.mockImplementation(
      (asset: { id: string; bucket: string; objectKey: string }) =>
        Promise.resolve({
          url: `https://media.example.com/${asset.id}?signature=fresh`,
          provider: 'azure_blob',
          bucket: asset.bucket,
          objectKey: asset.objectKey,
          expiresAt: '2026-07-30T12:05:00.000Z',
        }),
    );

    const resolved = await service.resolveForModel({
      schemaVersion: 'agent-attachment-resolve/v1',
      actor: { id: ACTOR_ID, displayName: 'Attachment Integration' },
      scope: {
        surface: 'crew-management',
        conversationId,
        sessionName: `agent:v1:conversation:${conversationId}`,
        kind: 'crew',
        crewId: 'attachment-integration-crew',
      },
      locale: 'en-GB',
      attachmentIds: [second.id, first.id],
    });
    expect(resolved.attachments.map((attachment) => attachment.id)).toEqual([
      second.id,
      first.id,
    ]);
    for (const attachment of resolved.attachments) {
      expect(attachment.kind).toBe('file');
      if (attachment.kind !== 'file') {
        throw new Error('Expected an image attachment to resolve as a file.');
      }
      expect(attachment.url).toContain('signature=fresh');
    }
    expect(conversations.authorizeExisting).toHaveBeenCalled();
  });

  it('revokes immediately and refuses subsequent model resolution', async () => {
    const mediaAssetId = await createImageAsset();
    const attachment = await registerImage(mediaAssetId, 'revoked.png');
    await expect(
      service.revoke(
        { userId: ACTOR_ID },
        {
          schemaVersion: 'agent-attachment-revoke/v1',
          conversationId,
          attachmentId: attachment.id,
          locale: 'en-GB',
        },
      ),
    ).resolves.toMatchObject({ status: 'revoked' });

    const error = await captureHttpException(
      service.resolveForModel({
        schemaVersion: 'agent-attachment-resolve/v1',
        actor: { id: ACTOR_ID, displayName: 'Attachment Integration' },
        scope: {
          surface: 'crew-management',
          conversationId,
          sessionName: `agent:v1:conversation:${conversationId}`,
          kind: 'crew',
          crewId: 'attachment-integration-crew',
        },
        locale: 'en-GB',
        attachmentIds: [attachment.id],
      }),
    );
    expect(error.getResponse()).toMatchObject({
      code: 'AGENT_ATTACHMENT_NOT_READY',
    });
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  function ingestResult(text: string, fileName: string) {
    const contentHash = createHash('sha256')
      .update(Buffer.from(text, 'utf8'))
      .digest('hex');
    return {
      projection: {
        kind: 'document_text' as const,
        text,
        charCount: text.length,
        pageCount: null,
        contentHash,
      },
      sourceIndex: buildStorySourceMaterialIndex({
        text,
        fileName,
        contentHash,
      }),
    };
  }

  function sectionAnalysis(chunkId: string, summary: string) {
    return {
      schemaVersion: 'agent-document-section-analysis/v1' as const,
      chunkId,
      heading: null,
      summary,
      storyBeats: [],
      characters: [],
      locations: [],
      plotThreads: [],
      continuityFindings: [],
      themes: [],
    };
  }

  async function registerImage(mediaAssetId: string, fileName: string) {
    return service.register(
      { userId: ACTOR_ID },
      {
        schemaVersion: 'agent-attachment-register/v1',
        conversationId,
        mediaAssetId,
        fileName,
        locale: 'en-GB',
      },
    );
  }

  async function createImageAsset(): Promise<string> {
    const id = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id,
        kind: MediaAssetKind.image,
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: 'agent-test',
        region: 'test',
        objectKey: `users/${ACTOR_ID}/agent-attachment-image-final/${id}.png`,
        contentType: 'image/png',
        sizeBytes: 128n,
        width: 16,
        height: 16,
        checksumSha256: 'a'.repeat(64),
        visibility: MediaAssetVisibility.private,
        status: MediaAssetStatus.ready,
        source: MediaAssetSource.user_upload,
        moderationStatus: MediaAssetModerationStatus.unreviewed,
        metadata: { uploadKind: 'agent_attachment_image' },
        createdByUserId: ACTOR_ID,
      },
    });
    return id;
  }

  async function createDocumentAsset(input: {
    mediaType: string;
    fileName: string;
    bytes: Buffer;
  }): Promise<string> {
    const id = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id,
        kind: MediaAssetKind.document,
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: 'agent-test',
        region: 'test',
        objectKey: `users/${ACTOR_ID}/agent-attachment-document/${id}/${input.fileName}`,
        contentType: input.mediaType,
        sizeBytes: BigInt(input.bytes.length),
        visibility: MediaAssetVisibility.private,
        status: MediaAssetStatus.ready,
        source: MediaAssetSource.user_upload,
        moderationStatus: MediaAssetModerationStatus.unreviewed,
        metadata: { uploadKind: 'agent_attachment_document' },
        createdByUserId: ACTOR_ID,
      },
    });
    return id;
  }

  function mockDocumentReadUrl(mediaAssetId: string): void {
    storage.createReadUrl.mockImplementation(
      (asset: { id: string; bucket: string; objectKey: string }) => {
        if (asset.id !== mediaAssetId) {
          throw new Error('unexpected media asset');
        }
        return Promise.resolve({
          url: `https://media.example.com/${asset.id}?signature=temporary`,
          provider: 'azure_blob',
          bucket: asset.bucket,
          objectKey: asset.objectKey,
          expiresAt: '2026-07-30T12:10:00.000Z',
        });
      },
    );
  }

  async function makeIngestDue(attachmentId: string): Promise<void> {
    await prisma.agentPlatformAttachmentIngestJob.update({
      where: { attachmentId },
      data: { availableAt: new Date(Date.now() - 1_000) },
    });
  }

  async function cleanup(): Promise<void> {
    if (!prisma) return;
    await prisma.agentPlatformConversation.deleteMany({
      where: { ownerActorId: ACTOR_ID },
    });
    await prisma.mediaAsset.deleteMany({
      where: { createdByUserId: ACTOR_ID },
    });
  }
});

async function captureHttpException(
  operation: Promise<unknown>,
): Promise<HttpException> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected operation to throw an HttpException.');
}
