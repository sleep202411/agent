import { createHash, randomUUID } from 'node:crypto';

import {
  AgentDocumentAnalysisArtifactKind,
  AgentDocumentAnalysisJobStatus,
  AgentPlatformAttachmentKind,
  AgentPlatformAttachmentStatus,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  type PrismaClient,
} from '@prisma/client';

import { buildStorySourceMaterialIndex } from '../agent-domain-gateway/story-source-material-index';
import { buildPrisma } from '../infra/db/db.module';
import { AGENT_DOCUMENT_ANALYSIS_VERSION } from './agent-platform-attachment.persistence';
import { AgentPlatformDocumentAnalysisDispatcherService } from './agent-platform-document-analysis-dispatcher.service';
import { AgentPlatformDocumentAnalysisService } from './agent-platform-document-analysis.service';
import type { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';

const describePostgres =
  process.env.AGENT_PLATFORM_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;
const ACTOR_ID = 'agent-platform-document-analysis-integration';
const MAX_DISPATCH_ATTEMPTS = 10;
// Long enough that a healthy `running` job in the same fixture can never be
// mistaken for an abandoned one while the retryable-failure branch is measured.
const STALE_RUN_SECONDS = 15 * 60;
const SECTION_TEXT_UNIT =
  '蜡烛在水泥地上吱呀作响，阿豪压低声音，眉毛拧成麻花。'.repeat(20);

/**
 * `claimDue` is exercised directly. Everything after it needs a live Temporal
 * front end, and what is under test here is the redelivery decision itself:
 * which rows the sweep is willing to take back, and whether the row it hands
 * on still satisfies the table's lifecycle constraint.
 */
type ClaimDueDispatcher = {
  claimDue(limit: number): Promise<Array<{ jobId: string; attempt: number }>>;
  deadLetterExhausted(): Promise<void>;
};

describePostgres('Agent Platform document analysis redelivery', () => {
  let prisma: PrismaClient;
  let analysis: AgentPlatformDocumentAnalysisService;
  let dispatcher: ClaimDueDispatcher;

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
    analysis = new AgentPlatformDocumentAnalysisService(prisma as never);
    dispatcher = new AgentPlatformDocumentAnalysisDispatcherService(
      prisma as never,
      {
        values: {
          documentAnalysisDispatchIntervalMs: 500,
          documentAnalysisDispatchLeaseMs: 45_000,
          documentAnalysisDispatchConcurrency: 4,
          documentAnalysisDispatchMaxAttempts: MAX_DISPATCH_ATTEMPTS,
          documentAnalysisStaleRunSeconds: STALE_RUN_SECONDS,
          temporal: {
            address: 'localhost:7233',
            namespace: 'default',
            documentTaskQueue: 'fizzdragon-agent-platform-v1-document',
          },
        },
      } as unknown as AgentPlatformGatewayConfigService,
    ) as unknown as ClaimDueDispatcher;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('re-claims a terminal failure the workflow reported as retryable, keeping its paid-for checkpoints', async () => {
    const job = await createAnalysisJob({ chunkCount: 12 });
    await startRunning(job.id);
    const checkpoints = await writeSections(job, 6);
    await analysis.fail({
      schemaVersion: 'agent-long-document-fail/v1',
      jobId: job.id,
      error: {
        code: 'AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID',
        message: 'FizzDragon could not complete the source document analysis.',
        retryable: true,
      },
    });
    await makeRedeliveryDue(job.id);

    const claims = await dispatcher.claimDue(4);

    expect(claims.map((claim) => claim.jobId)).toEqual([job.id]);
    expect(claims[0]?.attempt).toBe(2);
    const reclaimed = await prisma.agentDocumentAnalysisJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(reclaimed.status).toBe(AgentDocumentAnalysisJobStatus.dispatching);
    // The lifecycle check constraint rejects an in-flight row that still
    // carries a completion timestamp, so a reclaim that forgets to clear it
    // aborts the whole sweep transaction instead of redelivering anything.
    expect(reclaimed.completedAt).toBeNull();
    expect(reclaimed.error).toBeNull();
    // The finished sections are the reason the retry is cheap: the next run
    // reads them back out of the manifest instead of paying for them again.
    const manifest = await analysis.claim(job.id);
    expect(
      manifest.completedArtifacts.map((artifact) => artifact.artifactId).sort(),
    ).toEqual([...checkpoints].sort());
  });

  it('leaves a non-retryable failure terminal', async () => {
    const job = await createAnalysisJob({ chunkCount: 12 });
    await startRunning(job.id);
    await analysis.fail({
      schemaVersion: 'agent-long-document-fail/v1',
      jobId: job.id,
      error: {
        code: 'AGENT_DOCUMENT_ANALYSIS_SOURCE_UNAVAILABLE',
        message: 'The source document is not available.',
        retryable: false,
      },
    });
    await makeRedeliveryDue(job.id);

    expect(await dispatcher.claimDue(4)).toEqual([]);
    const untouched = await prisma.agentDocumentAnalysisJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(untouched.status).toBe(AgentDocumentAnalysisJobStatus.failed);
    expect(untouched.dispatchAttemptCount).toBe(1);
  });

  it('does not redeliver a retryable failure before its scheduled moment', async () => {
    const job = await createAnalysisJob({ chunkCount: 12 });
    await startRunning(job.id);
    await analysis.fail({
      schemaVersion: 'agent-long-document-fail/v1',
      jobId: job.id,
      error: {
        code: 'AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID',
        message: 'FizzDragon could not complete the source document analysis.',
        retryable: true,
      },
    });

    expect(await dispatcher.claimDue(4)).toEqual([]);
    const waiting = await prisma.agentDocumentAnalysisJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(waiting.nextDispatchAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('dead-letters a retryable failure whose redelivery budget is spent', async () => {
    const job = await createAnalysisJob({ chunkCount: 12 });
    await startRunning(job.id);
    await analysis.fail({
      schemaVersion: 'agent-long-document-fail/v1',
      jobId: job.id,
      error: {
        code: 'AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID',
        message: 'FizzDragon could not complete the source document analysis.',
        retryable: true,
      },
    });
    await prisma.agentDocumentAnalysisJob.update({
      where: { id: job.id },
      data: {
        dispatchAttemptCount: MAX_DISPATCH_ATTEMPTS,
        nextDispatchAt: new Date(Date.now() - 1_000),
      },
    });

    await dispatcher.deadLetterExhausted();

    const exhausted = await prisma.agentDocumentAnalysisJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(exhausted.status).toBe(AgentDocumentAnalysisJobStatus.dead_lettered);
    expect(exhausted.deadLetteredAt).not.toBeNull();
    // A job nothing will ever redeliver must stop advertising a recovery.
    expect(exhausted.error).toMatchObject({ retryable: false });
    expect(await dispatcher.claimDue(4)).toEqual([]);
  });

  async function createAnalysisJob(input: { chunkCount: number }) {
    // The indexer packs paragraphs up to its own section bound, so oversupply
    // material and let the produced index decide the real section count.
    const text = Array.from(
      { length: input.chunkCount * 5 },
      () => SECTION_TEXT_UNIT,
    ).join('\n\n');
    const contentHash = createHash('sha256')
      .update(Buffer.from(text, 'utf8'))
      .digest('hex');
    const index = buildStorySourceMaterialIndex({
      text,
      fileName: 'screenplay-fixture.docx',
      contentHash,
    });
    const conversation = await prisma.agentPlatformConversation.create({
      data: {
        ownerActorId: ACTOR_ID,
        surface: 'crew-management',
        scopeKind: 'crew',
        // The column is a hashed scope identity, not a readable key.
        scopeKey: createHash('sha256')
          .update('document-analysis-integration')
          .digest('hex'),
        scope: { kind: 'crew', crewId: 'document-analysis-integration' },
      },
    });
    const mediaAssetId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: mediaAssetId,
        kind: MediaAssetKind.document,
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: 'agent-test',
        region: 'test',
        objectKey: `users/${ACTOR_ID}/agent-analysis/${mediaAssetId}.docx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: BigInt(text.length),
        visibility: MediaAssetVisibility.private,
        status: MediaAssetStatus.ready,
        source: MediaAssetSource.user_upload,
        moderationStatus: MediaAssetModerationStatus.unreviewed,
        metadata: { uploadKind: 'agent_attachment_document' },
        createdByUserId: ACTOR_ID,
      },
    });
    const readyAt = new Date();
    const attachment = await prisma.agentPlatformAttachment.create({
      data: {
        conversationId: conversation.id,
        mediaAssetId,
        ownerActorId: ACTOR_ID,
        kind: AgentPlatformAttachmentKind.document_text,
        status: AgentPlatformAttachmentStatus.ready,
        fileName: 'screenplay-fixture.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: BigInt(text.length),
        locale: 'en-GB',
        documentText: text,
        documentCharCount: index.document.characterCount,
        contentHash,
        documentIndex: index as never,
        documentIndexVersion: 'story-source-material-index/v1',
        // ready_at may not precede created_at, so pin both to one instant.
        createdAt: readyAt,
        readyAt,
      },
    });
    const job = await prisma.agentDocumentAnalysisJob.create({
      data: {
        attachmentId: attachment.id,
        analysisVersion: AGENT_DOCUMENT_ANALYSIS_VERSION,
        sourceContentHash: contentHash,
        totalUnits: index.chunks.length + 2,
      },
    });
    return { id: job.id, chunkIds: index.chunks.map((chunk) => chunk.id) };
  }

  async function startRunning(jobId: string): Promise<void> {
    await prisma.agentDocumentAnalysisJob.update({
      where: { id: jobId },
      data: {
        status: AgentDocumentAnalysisJobStatus.running,
        temporalWorkflowId: `agent-document-analysis:${jobId}`,
        dispatchAttemptCount: 1,
        stage: 'mapping',
        startedAt: new Date(),
      },
    });
  }

  async function writeSections(
    job: { id: string; chunkIds: string[] },
    count: number,
  ): Promise<string[]> {
    const created: string[] = [];
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const chunkId = job.chunkIds[ordinal]!;
      const artifact = await prisma.agentDocumentAnalysisArtifact.create({
        data: {
          jobId: job.id,
          kind: AgentDocumentAnalysisArtifactKind.section,
          level: 0,
          ordinal,
          sourceChunkIds: [chunkId],
          inputArtifactIds: [],
          content: {
            schemaVersion: 'agent-document-section-analysis/v1',
            chunkId,
            heading: null,
            summary: `Bounded checkpoint for ${chunkId}.`,
            storyBeats: [],
            characters: [],
            locations: [],
            plotThreads: [],
            continuityFindings: [],
            themes: [],
          },
          contentHash: createHash('sha256').update(chunkId).digest('hex'),
        },
      });
      created.push(artifact.id);
    }
    await prisma.agentDocumentAnalysisJob.update({
      where: { id: job.id },
      data: { completedUnits: count },
    });
    return created;
  }

  async function makeRedeliveryDue(jobId: string): Promise<void> {
    await prisma.agentDocumentAnalysisJob.update({
      where: { id: jobId },
      data: { nextDispatchAt: new Date(Date.now() - 1_000) },
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
