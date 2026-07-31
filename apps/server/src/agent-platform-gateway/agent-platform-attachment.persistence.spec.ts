import { AgentAttachmentSummarySchema } from '@repo/shared/agent-platform';

import {
  type PublicAttachmentRow,
  toAttachmentSummary,
} from './agent-platform-attachment.persistence';

const ATTACHMENT_ID = '0197f4a2-0800-7000-8000-000000000009';
const CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000004';
const MEDIA_ASSET_ID = '0197f4a2-0800-7000-8000-000000000005';
const INGEST_JOB_ID = '0197f4a2-0800-7000-8000-000000000006';
const ANALYSIS_JOB_ID = '0197f4a2-0800-7000-8000-000000000010';
const FINAL_ARTIFACT_ID = '0197f4a2-0800-7000-8000-000000000011';

describe('Agent Platform attachment public status projection', () => {
  it('projects retry and analysis progress as one stable UI contract', () => {
    const summary = toAttachmentSummary(
      attachmentRow({
        ingestJob: {
          id: INGEST_JOB_ID,
          status: 'retry_wait',
          attemptCount: 2,
          maxAttempts: 5,
          stage: 'extracting',
          progress: 37,
          availableAt: new Date('2026-07-30T20:01:02.000Z'),
          error: null,
        },
        analysisJobs: [
          {
            id: ANALYSIS_JOB_ID,
            status: 'running',
            stage: 'analyzing_sections',
            completedUnits: 7,
            totalUnits: 20,
            error: null,
            artifacts: [],
          },
        ],
      }),
    );

    expect(AgentAttachmentSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      status: 'processing',
      ingest: {
        stage: 'extracting',
        progress: 37,
        attempt: 2,
        maximumAttempts: 5,
        nextAttemptAt: '2026-07-30T20:01:02.000Z',
      },
      analysis: {
        jobId: ANALYSIS_JOB_ID,
        status: 'running',
        stage: 'analyzing_sections',
        completedUnits: 7,
        totalUnits: 20,
        progress: 35,
        finalArtifactId: null,
        error: null,
      },
      error: null,
    });
  });

  it('publishes the immutable final artifact identity only after completion', () => {
    const summary = toAttachmentSummary(
      attachmentRow({
        status: 'ready',
        ingestJob: {
          id: INGEST_JOB_ID,
          status: 'succeeded',
          attemptCount: 1,
          maxAttempts: 5,
          stage: 'completed',
          progress: 100,
          availableAt: new Date('2026-07-30T20:01:02.000Z'),
          error: null,
        },
        analysisJobs: [
          {
            id: ANALYSIS_JOB_ID,
            status: 'succeeded',
            stage: 'completed',
            completedUnits: 20,
            totalUnits: 20,
            error: null,
            artifacts: [{ id: FINAL_ARTIFACT_ID }],
          },
        ],
      }),
    );

    expect(AgentAttachmentSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.ingest?.nextAttemptAt).toBeNull();
    expect(summary.analysis).toMatchObject({
      status: 'succeeded',
      progress: 100,
      finalArtifactId: FINAL_ARTIFACT_ID,
    });
  });
});

function attachmentRow(
  overrides: Partial<PublicAttachmentRow>,
): PublicAttachmentRow {
  return {
    id: ATTACHMENT_ID,
    conversationId: CONVERSATION_ID,
    mediaAssetId: MEDIA_ASSET_ID,
    ownerActorId: 'actor-1',
    kind: 'document_text',
    status: 'processing',
    fileName: 'feature-screenplay.pdf',
    mediaType: 'application/pdf',
    locale: 'zh-CN',
    sizeBytes: BigInt(98_765),
    documentText: null,
    documentCharCount: null,
    documentPageCount: null,
    contentHash: null,
    documentIndex: null,
    documentIndexVersion: null,
    error: null,
    readyAt: null,
    revokedAt: null,
    createdAt: new Date('2026-07-30T20:00:00.000Z'),
    updatedAt: new Date('2026-07-30T20:00:00.000Z'),
    ingestJob: null,
    analysisJobs: [],
    ...overrides,
  } as PublicAttachmentRow;
}
