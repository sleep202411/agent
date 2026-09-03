import { AiJobStatus } from '@prisma/client';
import {
  storyProductionGenerationBasePath,
  toStoryProductionGenerationProgressDto,
} from './story-production-generation.dto';

describe('Story production generation DTO projection', () => {
  it('builds Story-scoped asset and storyboard command paths', () => {
    expect(
      storyProductionGenerationBasePath({
        projectId: 'project-id',
        chapterId: 'chapter-id',
        generationId: 'generation-id',
        target: { kind: 'asset_spec', id: 'asset-id' },
      }),
    ).toBe(
      '/aurora/story-projects/project-id/chapters/chapter-id/asset-specs/asset-id/generations/generation-id',
    );
    expect(
      storyProductionGenerationBasePath({
        projectId: 'project-id',
        chapterId: 'chapter-id',
        generationId: 'generation-id',
        target: {
          kind: 'storyboard_clip',
          id: 'clip-id',
          sequenceId: 'sequence-id',
        },
      }),
    ).toBe(
      '/aurora/story-projects/project-id/chapters/chapter-id/storyboard/sequences/sequence-id/clips/clip-id/generations/generation-id',
    );
  });

  it('projects a terminal non-retryable materialization failure distinctly from the AI job', () => {
    expect(
      toStoryProductionGenerationProgressDto({
        submissionSnapshot: {
          effectiveOptions: { numOutputs: 2 },
        },
        materializedAt: null,
        materializationError: {
          code: 'STORY_GENERATION_OUTPUT_MISSING',
          retryable: false,
        },
        reconcileAttempts: 1,
        nextReconcileAt: null,
        aiJob: {
          id: 'job-id',
          modelId: 'model-id',
          schemaVersion: '1',
          status: AiJobStatus.completed,
          stage: 'completed',
          progress: 1,
          queuePosition: null,
          estimatedWaitSeconds: null,
          estimatedRunSeconds: null,
          estimatedTotalSeconds: null,
          etaConfidence: null,
          error: null,
        },
      }),
    ).toMatchObject({
      requestedOutputCount: 2,
      aiJob: { id: 'job-id', status: AiJobStatus.completed },
      materialization: {
        status: 'failed',
        attempts: 1,
        canRetry: false,
        error: {
          code: 'STORY_GENERATION_OUTPUT_MISSING',
          retryable: false,
        },
      },
    });
  });

  it('exposes explicit attachment retry only after automatic retries are exhausted', () => {
    expect(
      toStoryProductionGenerationProgressDto({
        submissionSnapshot: { effectiveOptions: {} },
        materializedAt: null,
        materializationError: {
          code: 'STORY_PROJECT_WRITE_BUSY',
          retryable: false,
          attachmentRetryable: true,
        },
        reconcileAttempts: 12,
        nextReconcileAt: null,
        aiJob: {
          id: 'job-id',
          modelId: 'model-id',
          schemaVersion: '1',
          status: AiJobStatus.completed,
          stage: 'completed',
          progress: 1,
          queuePosition: null,
          estimatedWaitSeconds: null,
          estimatedRunSeconds: null,
          estimatedTotalSeconds: null,
          etaConfidence: null,
          error: null,
        },
      }),
    ).toMatchObject({
      requestedOutputCount: 1,
      materialization: { status: 'failed', canRetry: true },
    });
  });
});
