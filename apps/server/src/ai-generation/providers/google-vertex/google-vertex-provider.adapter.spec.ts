import { GoogleVertexProviderAdapter } from './google-vertex-provider.adapter';
import type { GoogleVertexRuntimeConfig } from './google-vertex-runtime';

const imageRuntime = {
  provider: 'google-vertex',
  modelId: 'nano-banana-2',
  endpointId: 'gemini-3.1-flash-image',
  executionKind: 'gemini-image',
  location: 'global',
  type: 'image',
  generationModes: ['text_to_image', 'image_to_image'],
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      imageSize: { type: 'string', enum: ['1:1', '16:9'] },
      resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
    },
  },
} as unknown as GoogleVertexRuntimeConfig;

const videoRuntime = {
  provider: 'google-vertex',
  modelId: 'veo-3-1',
  endpointId: 'veo-3.1-generate-001',
  executionKind: 'veo',
  location: 'us-central1',
  type: 'video',
  generationModes: [
    'text_to_video',
    'image_to_video',
    'first_last_frame_to_video',
  ],
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      duration: { type: 'string', enum: ['4', '6', '8'] },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
      resolution: { type: 'string', enum: ['720p', '1080p', '4k'] },
      generateAudio: { type: 'boolean' },
      referenceImages: { type: 'array', maxItems: 3, items: {} },
    },
  },
} as unknown as GoogleVertexRuntimeConfig;

function createAdapter(args: {
  runtime: GoogleVertexRuntimeConfig;
  client: Record<string, jest.Mock>;
  prisma?: { aiJob: { findFirst: jest.Mock } };
}) {
  return new GoogleVertexProviderAdapter(
    {
      config: {
        project: 'project-a',
        imageLocation: 'global',
        videoLocation: 'us-central1',
        videoPollDelayMs: 15_000,
      },
    } as never,
    {
      getRuntimeConfig: jest.fn().mockResolvedValue(args.runtime),
    } as never,
    args.client as never,
    (args.prisma ?? { aiJob: { findFirst: jest.fn() } }) as never,
  );
}

describe('GoogleVertexProviderAdapter', () => {
  it('returns inline image output through the synchronous provider path', async () => {
    const client = {
      generateImage: jest.fn().mockResolvedValue({
        outputs: [
          {
            buffer: Buffer.from('png-output'),
            mimeType: 'image/png',
            ext: 'png',
          },
        ],
        requestId: 'image-request-1',
        status: 200,
        headers: { 'x-goog-request-id': 'image-request-1' },
        responseSummary: { candidateCount: 1 },
      }),
    };
    const adapter = createAdapter({ runtime: imageRuntime, client });

    const result = await adapter.startGeneration(
      'nano-banana-2',
      {
        prompt: 'A burning painted boat on the Qinhuai River',
        imageSize: '16:9',
        resolution: '2K',
        outputFormat: 'png',
      },
      { jobId: 'job-image-1', userId: 'user-1' } as never,
    );

    expect(client.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'image',
        model: 'gemini-3.1-flash-image',
        aspectRatio: '16:9',
        imageSize: '2K',
      }),
    );
    expect(result).toMatchObject({
      kind: 'completed',
      providerRequestId: 'image-request-1',
      providerEndpoint: 'gemini-3.1-flash-image',
      outputs: [
        {
          type: 'image',
          mimeType: 'image/png',
          ext: 'png',
        },
      ],
    });
  });

  it('persists the Google operation name and resumes Veo through polling', async () => {
    const client = {
      startVideo: jest.fn().mockResolvedValue({
        operationName:
          'projects/project-a/locations/us-central1/operations/op-1',
        requestId: 'video-request-1',
        headers: {},
        responseSummary: { done: false },
      }),
      pollVideo: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          requestId: 'video-request-1',
          status: 200,
          headers: {},
          responseSummary: { done: false },
        })
        .mockResolvedValueOnce({
          done: true,
          response: {
            generatedVideos: [
              {
                video: {
                  videoBytes: Buffer.from('mp4-output').toString('base64'),
                  mimeType: 'video/mp4',
                },
              },
            ],
          },
          requestId: 'video-request-1',
          status: 200,
          headers: {},
          responseSummary: { done: true, generatedVideoCount: 1 },
        }),
    };
    const adapter = createAdapter({ runtime: videoRuntime, client });

    const start = await adapter.startGeneration(
      'veo-3-1',
      {
        prompt: 'A rain-soaked Ming dynasty river chase',
        resolution: '1080p',
        aspectRatio: '16:9',
        duration: '8',
        generateAudio: true,
      },
      { jobId: 'job-video-1', userId: 'user-1' } as never,
    );
    expect(start).toMatchObject({
      kind: 'pending',
      providerJobId: 'projects/project-a/locations/us-central1/operations/op-1',
      initialPollDelayMs: 15_000,
    });

    const pending = await adapter.pollStatus(
      'projects/project-a/locations/us-central1/operations/op-1',
      { providerEndpoint: 'veo-3.1-generate-001' } as never,
    );
    expect(pending.kind).toBe('pending');

    const completed = await adapter.pollStatus(
      'projects/project-a/locations/us-central1/operations/op-1',
      {
        providerEndpoint: 'veo-3.1-generate-001',
        providerRequest: { durationSeconds: 8 },
      } as never,
    );
    expect(completed).toMatchObject({
      kind: 'completed',
      outputs: [
        {
          type: 'video',
          mimeType: 'video/mp4',
          ext: 'mp4',
          durationSeconds: 8,
        },
      ],
    });
  });

  it('maps a completed safety-filtered Veo operation to a non-retryable failure', async () => {
    const client = {
      pollVideo: jest.fn().mockResolvedValue({
        done: true,
        response: {
          generatedVideos: [],
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: ['SAFETY'],
        },
        requestId: 'video-request-filtered',
        status: 200,
        headers: {},
        responseSummary: { done: true, raiMediaFilteredCount: 1 },
      }),
    };
    const adapter = createAdapter({ runtime: videoRuntime, client });

    const result = await adapter.pollStatus('operation-filtered');
    expect(result).toMatchObject({
      kind: 'failed',
      error: {
        code: 'PROVIDER_CONTENT_FILTER',
        retryable: false,
      },
    });
  });

  it('resolves a same-workspace Gemini Omni interaction before stateful editing', async () => {
    const runtime = {
      ...videoRuntime,
      modelId: 'gemini-omni-flash-preview',
      endpointId: 'gemini-omni-flash-preview',
      executionKind: 'omni',
      location: 'global',
      generationModes: ['text_to_video', 'video_to_video'],
      inputSchema: {
        type: 'object',
        properties: {
          duration: {
            type: 'string',
            enum: ['3', '4', '5', '6', '7', '8', '9', '10'],
          },
          aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
          resolution: { type: 'string', enum: ['720p'] },
          sourceVideo: { type: 'object', properties: {} },
        },
      },
    } as unknown as GoogleVertexRuntimeConfig;
    const findFirst = jest.fn((query: Record<string, unknown>) => {
      void query;
      return Promise.resolve({
        attempts: [{ providerRequestId: 'interaction-source-1' }],
      });
    });
    const client = {
      startOmni: jest.fn().mockResolvedValue({
        state: 'pending',
        interactionId: 'interaction-edit-2',
        interactionStatus: 'queued',
        requestId: 'request-omni-1',
        status: 200,
        headers: {},
        responseSummary: { status: 'queued' },
      }),
      pollOmni: jest.fn().mockResolvedValue({
        state: 'completed',
        output: {
          buffer: Buffer.from('omni-mp4'),
          mimeType: 'video/mp4',
          ext: 'mp4',
        },
        interactionId: 'interaction-edit-2',
        interactionStatus: 'completed',
        requestId: 'request-omni-2',
        status: 200,
        headers: {},
        responseSummary: { status: 'completed' },
      }),
    };
    const adapter = createAdapter({
      runtime,
      client,
      prisma: { aiJob: { findFirst } },
    });

    const result = await adapter.startGeneration(
      runtime.modelId,
      {
        prompt: 'Make the rain heavier',
        sourceVideo: {
          url: 'https://media.example/source.mp4',
          sourceJobId: '019f-source-job',
        },
        resolution: '720p',
        aspectRatio: '16:9',
        duration: '8',
      },
      {
        jobId: 'job-omni-edit',
        userId: 'user-1',
        workspaceId: '019f-workspace',
      } as never,
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    const sourceQuery = findFirst.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(sourceQuery.where).toMatchObject({
      id: '019f-source-job',
      userId: 'user-1',
      workspaceId: '019f-workspace',
      provider: 'google-vertex',
      deployment: 'gemini-omni-flash-preview',
    });
    expect(client.startOmni).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'omni',
        task: 'edit',
        previousInteractionId: 'interaction-source-1',
      }),
    );
    expect(result).toMatchObject({
      kind: 'pending',
      providerJobId: 'interaction-edit-2',
      providerRequestId: 'interaction-edit-2',
    });

    const completed = await adapter.pollStatus('interaction-edit-2', {
      providerEndpoint: 'gemini-omni-flash-preview',
      providerRequest: { durationSeconds: 8 },
    });
    expect(client.pollOmni).toHaveBeenCalledWith('interaction-edit-2');
    expect(completed).toMatchObject({
      kind: 'completed',
      providerRequestId: 'interaction-edit-2',
      outputs: [{ type: 'video', durationSeconds: 8 }],
    });
  });

  it('fails closed when the selected Google binding is absent or disabled', async () => {
    const adapter = new GoogleVertexProviderAdapter(
      { config: {} } as never,
      { getRuntimeConfig: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { aiJob: { findFirst: jest.fn() } } as never,
    );

    await expect(
      adapter.startGeneration('veo-3-1', {}, {
        jobId: 'job-missing',
        userId: 'user-1',
      } as never),
    ).rejects.toMatchObject({
      payload: { code: 'PROVIDER_NOT_CONFIGURED', retryable: false },
    });
  });
});
