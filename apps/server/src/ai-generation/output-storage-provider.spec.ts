import { MediaStorageProvider } from '@prisma/client';
import type { AuthUser } from '../auth';
import { AiGenerationService } from './ai-generation.service';
import { STORY_STUDIO_WORKBENCH_SURFACE } from './output-storage-target';
import { AiGenerationRepository } from './repository';
import type { AiJob, AiJobOutput, AiJobType, AiSubmitJobBody } from './types';
import { AiGenerationWorkerService } from './worker.service';

describe('AiGenerationService submit-time storage pin', () => {
  it('freezes the S3-compatible backend on the job row it hands the repository', async () => {
    // The column is what the worker reads on every attempt, so the pin has to
    // reach the inserted row — resolving it correctly and dropping it on the
    // floor would ship the feature dead, with the configured provider missing from new jobs.
    const harness = submitHarness('video');

    await harness.service.submitJob(
      userFixture(),
      submitBody(STORY_STUDIO_WORKBENCH_SURFACE),
    );

    expect(harness.store.reserveQueuedJob).toHaveBeenCalledTimes(1);
    expect(harness.built()).toMatchObject({
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
      outputStorageProvider: MediaStorageProvider.s3_compatible,
    });
  });

  it('passes compiled media references into atomic admission, including expanded characters', async () => {
    const references = [
      {
        assetId: '01900000-0000-7000-8000-000000000001',
        refId: 'image',
        kind: 'image',
      },
      {
        assetId: '01900000-0000-7000-8000-000000000002',
        refId: 'character',
        kind: 'image',
        characterId: 'character-1',
      },
      { refId: 'external', kind: 'image' },
    ];
    const harness = submitHarness('image', references);
    await harness.service.submitJob(
      userFixture(),
      submitBody(STORY_STUDIO_WORKBENCH_SURFACE),
    );
    expect(harness.store.reserveQueuedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        references: references.slice(0, 2),
      }),
    );
  });

  it('freezes the same configured provider for image jobs', async () => {
    const harness = submitHarness('image');

    await harness.service.submitJob(
      userFixture(),
      submitBody(STORY_STUDIO_WORKBENCH_SURFACE),
    );

    expect(harness.built().outputStorageProvider).toBe(
      MediaStorageProvider.s3_compatible,
    );
  });

  it('freezes trusted retry lineage on the replacement job', async () => {
    const harness = submitHarness('image');
    const previousJobId = '01900000-0000-7000-8000-000000000099';

    await harness.service.submitJob(
      userFixture(),
      submitBody(STORY_STUDIO_WORKBENCH_SURFACE),
      undefined,
      { retryOfJobId: previousJobId },
    );

    expect(harness.built().retryOfJobId).toBe(previousJobId);
  });
});

describe('AiGenerationRepository output storage persistence', () => {
  it('round-trips a pinned provider through both job mappers', () => {
    const repository = new AiGenerationRepository({} as never, {} as never);
    const row = toRow(
      repository,
      jobFixture(MediaStorageProvider.s3_compatible),
    );

    expect(row.outputStorageProvider).toBe(MediaStorageProvider.s3_compatible);
    expect(toDomain(repository, row).outputStorageProvider).toBe(
      MediaStorageProvider.s3_compatible,
    );
  });

  it('round-trips the cell default as NULL', () => {
    const repository = new AiGenerationRepository({} as never, {} as never);
    const row = toRow(repository, jobFixture(null));

    expect(row.outputStorageProvider).toBeNull();
    expect(toDomain(repository, row).outputStorageProvider).toBeNull();
  });
});

describe('AiGenerationWorkerService output storage selection', () => {
  it('uploads through the bound default when the job pins no provider', async () => {
    const fallback = storageDouble('azure_blob');
    const pinned = storageDouble('s3_compatible');
    const registry = { forProvider: jest.fn(() => pinned) };
    const store = { createAiOutputAsset: jest.fn(() => 'asset-1') };
    const worker = workerWith({ fallback, registry, store });

    await uploadOutputs(worker, jobFixture(null), [rawOutput()]);

    expect(fallback.upload).toHaveBeenCalledTimes(1);
    expect(pinned.upload).not.toHaveBeenCalled();
    expect(registry.forProvider).not.toHaveBeenCalled();
    expect(store.createAiOutputAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storageProvider: 'azure_blob' }),
    );
  });

  it('uploads through the S3 service when the job carries s3_compatible', async () => {
    const fallback = storageDouble('azure_blob');
    const pinned = storageDouble('s3_compatible');
    const registry = { forProvider: jest.fn(() => pinned) };
    const store = { createAiOutputAsset: jest.fn(() => 'asset-1') };
    const worker = workerWith({ fallback, registry, store });

    await uploadOutputs(
      worker,
      jobFixture(MediaStorageProvider.s3_compatible),
      [rawOutput()],
    );

    expect(registry.forProvider).toHaveBeenCalledWith('s3_compatible');
    expect(pinned.upload).toHaveBeenCalledTimes(1);
    expect(fallback.upload).not.toHaveBeenCalled();
    // The asset row records where the bytes actually landed, so the read
    // resolver and a later takedown both find the R2 object.
    expect(store.createAiOutputAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storageProvider: 's3_compatible',
        bucket: 's3_compatible-bucket',
      }),
    );
  });

  it.each([
    MediaStorageProvider.s3_compatible,
    MediaStorageProvider.aliyun_oss,
  ])(
    'sends spooled video bytes to the recorded %s provider',
    async (provider) => {
      // Video takes its own
      // spool-probe-uploadFromFile branch. A pin honoured on the image branch
      // alone would leave every real Story Studio output on the cell default.
      const fallback = storageDouble('azure_blob');
      const pinned = storageDouble(provider);
      const registry = { forProvider: jest.fn(() => pinned) };
      const store = { createAiOutputAsset: jest.fn(() => 'asset-1') };
      const worker = workerWith({
        fallback,
        registry,
        store,
        videoProbe: videoProbeDouble(),
      });

      await uploadOutputs(worker, { ...jobFixture(provider), type: 'video' }, [
        rawVideoOutput(),
      ]);

      expect(registry.forProvider).toHaveBeenCalledWith(provider);
      expect(pinned.uploadFromFile).toHaveBeenCalledTimes(1);
      expect(fallback.uploadFromFile).not.toHaveBeenCalled();
      expect(pinned.upload).not.toHaveBeenCalled();
      expect(store.createAiOutputAsset).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'video',
          storageProvider: provider,
          bucket: `${provider}-bucket`,
        }),
      );
    },
  );

  it('keeps a retried attempt on the same store and object key', async () => {
    // The requeued attempt re-uploads the same bytes. It has to converge on
    // the first attempt's object: a second store would leave one of the two
    // uploads unreferenced by the job row.
    const fallback = storageDouble('azure_blob');
    const pinned = storageDouble('s3_compatible');
    const registry = { forProvider: jest.fn(() => pinned) };
    const worker = workerWith({
      fallback,
      registry,
      store: { createAiOutputAsset: jest.fn(() => 'asset-1') },
    });
    const job = jobFixture(MediaStorageProvider.s3_compatible);

    await uploadOutputs(worker, { ...job, attempt: 1 }, [rawOutput()]);
    await uploadOutputs(worker, { ...job, attempt: 2 }, [rawOutput()]);

    expect(fallback.upload).not.toHaveBeenCalled();
    expect(pinned.upload).toHaveBeenCalledTimes(2);
    const [first, second] = pinned.upload.mock.calls.map(
      ([input]) => input.key,
    );
    expect(second).toBe(first);
  });
});

function storageDouble(provider: string) {
  const landed = (key: string) => ({
    url: `https://${provider}.example.test/${key}`,
    storagePath: key,
    bytes: 12,
    provider,
    bucket: `${provider}-bucket`,
    region: null,
  });
  return {
    upload: jest.fn((input: { key: string; contentType: string }) =>
      landed(input.key),
    ),
    uploadFromFile: jest.fn((input: { key: string; contentType: string }) =>
      landed(input.key),
    ),
  };
}

/** Measured video facts, so the video branch reaches its upload. */
function videoProbeDouble() {
  return {
    probeFile: jest.fn(() => ({
      width: 1920,
      height: 1080,
      durationMs: 8375,
      durationSeconds: 8,
      durationSecondsExact: 8.375,
      contentType: 'video/mp4',
      fileExtension: 'mp4',
      videoCodec: 'h264',
      audioCodecs: [],
      browserSafeMp4: true,
    })),
  };
}

function workerWith(input: {
  fallback: object;
  registry: object;
  store: object;
  videoProbe?: object;
}): AiGenerationWorkerService {
  return new AiGenerationWorkerService(
    input.store as never,
    {} as never,
    {} as never,
    input.fallback as never,
    input.registry as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueueAutomaticChecks: jest.fn() } as never,
    (input.videoProbe ?? {}) as never,
    {} as never,
    {} as never,
  );
}

/**
 * Drives the real `submitJob` far enough to capture the row `buildJob`
 * composes, which is the only place the pin is written.
 */
function submitHarness(
  type: AiJobType,
  references: Array<{
    assetId?: string;
    refId: string;
    kind: string;
    characterId?: string;
  }> = [],
) {
  let built: AiJob | null = null;
  const store = {
    findByIdempotency: jest.fn(() => null),
    recordProviderTraceEvent: jest.fn(),
    findById: jest.fn(() => built),
    reserveQueuedJob: jest.fn(
      (options: { buildJob: (queuePosition: number) => AiJob }) => {
        built = options.buildJob(0);
        return { kind: 'created', job: built, repositioned: [] };
      },
    ),
  };
  const service = new AiGenerationService(
    {} as never,
    {} as never,
    { assertCanUseModel: jest.fn(), assertCanUseOptions: jest.fn() } as never,
    {
      applyTrustedMediaFacts: jest.fn((input: Record<string, unknown>) =>
        Promise.resolve(input),
      ),
      normalizeInput: jest.fn(
        (_schema: object, input: Record<string, unknown>) => input,
      ),
    } as never,
    store as never,
    {
      estimateForNewJob: jest.fn(() => ({
        estimatedWaitSeconds: 1,
        estimatedRunSeconds: 2,
        estimatedTotalSeconds: 3,
        etaConfidence: 'low',
      })),
    } as never,
    { record: jest.fn() } as never,
    { enqueue: jest.fn() } as never,
    { resolve: jest.fn(() => routingDecision(type)) } as never,
    {} as never,
    { requireWorkspaceRole: jest.fn() } as never,
    {} as never,
    {} as never,
    {
      resolveForUser: jest.fn(() => ({
        subject: { type: 'user', id: 'user-1' },
      })),
    } as never,
    {} as never,
    {} as never,
    {
      compile: jest.fn(
        (args: { normalizedInput: Record<string, unknown> }) => ({
          normalizedInput: args.normalizedInput,
          snapshot: {
            displayText: 'prompt',
            searchText: 'prompt',
            compiledPrompt: 'prompt',
            references,
            styles: [],
          },
        }),
      ),
    } as never,
    {
      rejectClientAssetReferences: jest.fn(),
      expandCharacterBindings: jest.fn(
        (args: { input: Record<string, unknown> }) => ({
          input: args.input,
          bindings: [],
          characterKinds: {},
          expansions: [],
        }),
      ),
    } as never,
    {} as never,
    { requireUseAccessById: jest.fn() } as never,
  );
  return {
    service,
    store,
    built: (): AiJob => {
      if (!built) throw new Error('buildJob was never invoked');
      return built;
    },
  };
}

function routingDecision(type: AiJobType) {
  return {
    provider: 'provider-test',
    model: {
      id: 'model-test',
      type,
      deployment: 'deployment-test',
      enabled: true,
      schemaVersion: '1',
      input_schema: { properties: {} },
    },
    snapshot: {
      selectedProvider: 'provider-test',
      selectedDeployment: 'deployment-test',
      selectedCanonicalModelId: null,
      selectedProviderBindingId: null,
      policy: {
        concurrency: {
          queueName:
            type === 'video' ? 'ai-video-generation' : 'ai-image-generation',
          subject: null,
          perSubjectQueued: null,
        },
        entitlement: { queuePriority: 1 },
        quota: { cost: 1 },
      },
    },
  };
}

function userFixture(): AuthUser {
  return { userId: 'user-1' } as AuthUser;
}

function submitBody(sourceSurface: string): AiSubmitJobBody {
  return {
    modelId: 'model-test',
    schemaVersion: '1',
    input: {},
    idempotencyKey: 'idempotency-test',
    context: {
      workspaceId: '01900000-0000-7000-8000-0000000000ff',
      sourceSurface,
    },
  };
}

function jobFixture(outputStorageProvider: MediaStorageProvider | null): AiJob {
  const now = '2026-07-26T12:00:00.000Z';
  return {
    id: '01900000-0000-7000-8000-000000000001',
    userId: 'user-1',
    workspaceId: '01900000-0000-7000-8000-0000000000ff',
    type: 'image',
    provider: 'fal-ai',
    modelId: 'model',
    deployment: 'deployment',
    canonicalModelId: null,
    providerBindingId: null,
    schemaVersion: '1',
    outputStorageProvider,
    status: 'in_queue',
    stage: 'queued',
    input: {},
    normalizedInput: {},
    prompt: 'prompt',
    idempotencyKey: 'idempotency-test',
    outputs: [],
    logs: [],
    queueName: 'ai-image-generation',
    queuePosition: 0,
    attempt: 1,
    createdAt: now,
    queuedAt: now,
    updatedAt: now,
    metrics: {},
  };
}

function rawOutput() {
  return {
    index: 0,
    type: 'image' as AiJobType,
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    ext: 'png',
  };
}

function rawVideoOutput() {
  return {
    index: 0,
    type: 'video' as AiJobType,
    buffer: Buffer.from('provider-video-bytes'),
    mimeType: 'video/provider-claimed',
    ext: 'bin',
  };
}

function toRow(
  repository: AiGenerationRepository,
  job: AiJob,
): Record<string, unknown> {
  return (
    repository as unknown as {
      toRow: (job: AiJob) => Record<string, unknown>;
    }
  ).toRow(job);
}

function toDomain(
  repository: AiGenerationRepository,
  row: Record<string, unknown>,
): AiJob {
  return (
    repository as unknown as {
      toDomain: (row: Record<string, unknown>) => AiJob;
    }
  ).toDomain({ ...row, outputs: [] });
}

function uploadOutputs(
  worker: AiGenerationWorkerService,
  job: AiJob,
  raws: object[],
): Promise<AiJobOutput[]> {
  return (
    worker as unknown as {
      uploadOutputs: (job: AiJob, raws: object[]) => Promise<AiJobOutput[]>;
    }
  ).uploadOutputs(job, raws);
}
