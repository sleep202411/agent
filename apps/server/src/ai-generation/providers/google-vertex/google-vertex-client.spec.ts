import { GoogleVertexClient } from './google-vertex-client';

describe('GoogleVertexClient image generation', () => {
  it('accepts SDK responses that omit responseInternal metadata', async () => {
    const generateContent = jest.fn().mockResolvedValue({
      responseId: 'image-response-1',
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from('image-output').toString('base64'),
                  mimeType: 'image/png',
                },
              },
            ],
          },
        },
      ],
      sdkHttpResponse: {
        headers: { 'x-goog-request-id': 'request-image-1' },
      },
    });
    const client = new GoogleVertexClient(
      {
        config: {
          enabled: true,
          project: 'project-a',
          imageLocation: 'global',
          videoLocation: 'us-central1',
          requestTimeoutMs: 300_000,
          catalogRefreshMs: 900_000,
          videoPollDelayMs: 15_000,
          mediaAllowedHosts: new Set<string>(),
        },
      } as never,
      { loadImages: jest.fn().mockResolvedValue([]) } as never,
    );
    (
      client as unknown as {
        clients: Map<string, { models: { generateContent: jest.Mock } }>;
      }
    ).clients.set('global', { models: { generateContent } });

    const result = await client.generateImage({
      kind: 'image',
      model: 'gemini-3-pro-image',
      location: 'global',
      prompt: 'A rain-soaked Ming Dynasty cabin.',
      referenceUrls: [],
      aspectRatio: '16:9',
      imageSize: '1K',
      outputMimeType: 'image/png',
      labels: { fizzdragon_job_id: 'job-image-1' },
    });

    expect(result.status).toBeNull();
    expect(result.outputs).toEqual([
      expect.objectContaining({
        buffer: Buffer.from('image-output'),
        mimeType: 'image/png',
        ext: 'png',
      }),
    ]);
  });
});

describe('GoogleVertexClient Gemini Omni interactions', () => {
  it('starts a stored background video interaction and polls its inline MP4', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'interaction-1',
      status: 'queued',
      sdkHttpResponse: {
        headers: { 'x-goog-request-id': 'request-1' },
        responseInternal: { status: 200 },
      },
    });
    const get = jest.fn().mockResolvedValue({
      id: 'interaction-1',
      status: 'completed',
      output_video: {
        type: 'video',
        data: Buffer.from('video-output').toString('base64'),
        mime_type: 'video/mp4',
      },
      sdkHttpResponse: {
        headers: { 'x-goog-request-id': 'request-2' },
        responseInternal: { status: 200 },
      },
    });
    const mediaLoader = {
      loadImages: jest.fn().mockResolvedValue([]),
      loadVideo: jest.fn(),
    };
    const client = new GoogleVertexClient(
      {
        config: {
          enabled: true,
          project: 'project-a',
          imageLocation: 'global',
          videoLocation: 'us-central1',
          requestTimeoutMs: 300_000,
          catalogRefreshMs: 900_000,
          videoPollDelayMs: 15_000,
          mediaAllowedHosts: new Set<string>(),
        },
      } as never,
      mediaLoader as never,
    );
    (
      client as unknown as {
        clients: Map<
          string,
          { interactions: { create: jest.Mock; get: jest.Mock } }
        >;
      }
    ).clients.set('global', { interactions: { create, get } });

    const started = await client.startOmni({
      kind: 'omni',
      model: 'gemini-omni-flash-preview',
      location: 'global',
      prompt: 'A rain-soaked painted boat races down the Qinhuai River.',
      task: 'text_to_video',
      referenceUrls: [],
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 8,
      labels: { fizzdragon_job_id: 'job-1' },
    });

    expect(create).toHaveBeenCalledWith(
      {
        api_version: 'v1beta1',
        model: 'gemini-omni-flash-preview',
        input: [
          {
            type: 'text',
            text: 'A rain-soaked painted boat races down the Qinhuai River.',
          },
        ],
        stream: false,
        background: true,
        store: true,
        response_format: [
          {
            type: 'video',
            aspect_ratio: '16:9',
            duration: '8s',
            delivery: 'inline',
          },
        ],
        generation_config: { video_config: { task: 'text_to_video' } },
        labels: { fizzdragon_job_id: 'job-1' },
      },
      { timeout: 300_000, maxRetries: 0 },
    );
    expect(started).toMatchObject({
      state: 'pending',
      interactionId: 'interaction-1',
      interactionStatus: 'queued',
      requestId: 'request-1',
    });

    const completed = await client.pollOmni('interaction-1');
    expect(get).toHaveBeenCalledWith(
      'interaction-1',
      { api_version: 'v1beta1', stream: false },
      { timeout: 300_000, maxRetries: 0 },
    );
    expect(completed).toMatchObject({
      state: 'completed',
      interactionId: 'interaction-1',
      interactionStatus: 'completed',
      output: { mimeType: 'video/mp4', ext: 'mp4' },
    });
    expect(completed.output?.buffer).toEqual(Buffer.from('video-output'));
    expect(mediaLoader.loadVideo).not.toHaveBeenCalled();
  });
  it.each(['submit', 'poll'])(
    'preserves Interactions %s rejection details',
    async (phase) => {
      const rejection = Object.assign(new Error('400 provider response'), {
        status: 400,
        error: { message: 'Reference image dimensions are unsupported.' },
      });
      const create = jest.fn().mockRejectedValue(rejection);
      const get = jest.fn().mockRejectedValue(rejection);
      const client = new GoogleVertexClient(
        { config: { enabled: true, requestTimeoutMs: 300000 } } as never,
        { loadImages: jest.fn().mockResolvedValue([]) } as never,
      );
      (client as unknown as { clients: Map<string, unknown> }).clients.set(
        'global',
        { interactions: { create, get } },
      );
      const pending =
        phase === 'poll'
          ? client.pollOmni('failed-interaction')
          : client.startOmni({
              kind: 'omni',
              model: 'gemini-omni-flash-preview',
              location: 'global',
              prompt: 'Fixture',
              task: 'text_to_video',
              referenceUrls: [],
              aspectRatio: '16:9',
              resolution: '720p',
              durationSeconds: 8,
              labels: {},
            });
      await expect(pending).rejects.toMatchObject({
        payload: {
          code: 'VALIDATION_ERROR',
          retryable: false,
          userMessage: 'Reference image dimensions are unsupported.',
        },
      });
      expect(phase === 'poll' ? get : create).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['Request blocked because the quota was exhausted.', 'UNKNOWN'],
    ['Organization policy does not allow this model.', 'UNKNOWN'],
    ['Safety service is temporarily unavailable.', 'UNKNOWN'],
    ['Request blocked by safety policy.', 'PROVIDER_CONTENT_FILTER'],
  ])('classifies terminal error accurately: %s', async (message, code) => {
    const get = jest.fn().mockResolvedValue({
      id: 'failed-interaction',
      status: 'failed',
      errors: [{ message }],
    });
    const client = new GoogleVertexClient(
      { config: { enabled: true, requestTimeoutMs: 300000 } } as never,
      {} as never,
    );
    (client as unknown as { clients: Map<string, unknown> }).clients.set(
      'global',
      { interactions: { get } },
    );
    const result = await client.pollOmni('failed-interaction');
    expect(result.failure?.code).toBe(code);
    if (code === 'UNKNOWN') expect(result.failure?.userMessage).toBe(message);
  });

  it('does not combine unrelated error messages into a moderation refusal', async () => {
    const get = jest.fn().mockResolvedValue({
      id: 'failed-interaction',
      status: 'failed',
      errors: [
        { message: 'Request blocked because the quota was exhausted.' },
        { message: 'Safety service is temporarily unavailable.' },
      ],
    });
    const client = new GoogleVertexClient(
      { config: { enabled: true, requestTimeoutMs: 300000 } } as never,
      {} as never,
    );
    (client as unknown as { clients: Map<string, unknown> }).clients.set(
      'global',
      { interactions: { get } },
    );
    expect((await client.pollOmni('failed-interaction')).failure).toMatchObject(
      {
        code: 'UNKNOWN',
        userMessage:
          'Request blocked because the quota was exhausted. Safety service is temporarily unavailable.',
      },
    );
  });

  it('retains a terminal interaction error message instead of a generic retry', async () => {
    const get = jest.fn().mockResolvedValue({
      id: 'failed-interaction',
      status: 'failed',
      errors: [{ message: 'Reference video could not be decoded.' }],
    });
    const client = new GoogleVertexClient(
      { config: { enabled: true, requestTimeoutMs: 300000 } } as never,
      {} as never,
    );
    (client as unknown as { clients: Map<string, unknown> }).clients.set(
      'global',
      { interactions: { get } },
    );
    expect(await client.pollOmni('failed-interaction')).toMatchObject({
      state: 'failed',
      failure: { userMessage: 'Reference video could not be decoded.' },
    });
  });
});
