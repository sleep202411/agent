import { APICallError, generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import {
  runStoryAuthoringStage,
  describeModelError,
  StoryAuthoringStageError,
  createStoryAuthoringModel,
} from './story-authoring-model';

jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateObject: jest.fn(),
  };
});

const mockedGenerateObject = jest.mocked(generateObject);

describe('runStoryAuthoringStage', () => {
  it('uses Qwen-compatible JSON Object through the real SDK and provider', async () => {
    const previous = process.env.ALIBABA_API_KEY;
    process.env.ALIBABA_API_KEY = 'unit-test-key';
    mockedGenerateObject.mockImplementationOnce(
      jest.requireActual<typeof import('ai')>('ai').generateObject,
    );
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url, init) => {
        const body = JSON.parse(init!.body as string) as {
          response_format?: { type: string };
        };
        if (body.response_format?.type !== 'json_object') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  message: 'Unsupported response_format for qwen3-max',
                  type: 'invalid_request_error',
                  code: 'InvalidParameter',
                },
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'fixture',
              created: 1,
              model: 'qwen3-max',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '{"value":"ok"}' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      });
    try {
      await expect(
        runStoryAuthoringStage(createStoryAuthoringModel('qwen3-max'), {
          stage: 'structure',
          schema: z.object({ value: z.string() }),
          system: 'Return the fixture.',
          prompt: 'fixture',
          maxOutputTokens: 32,
          timeoutMs: 1000,
          maxAttempts: 1,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ value: 'ok' });
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as {
        response_format: { type: string };
        messages: unknown;
        max_tokens: number;
        enable_thinking: boolean;
      };
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(JSON.stringify(body.messages)).toContain('JSON');
      expect(JSON.stringify(body.messages)).toContain('required');
      expect(body.max_tokens).toBe(32);
      expect(body.enable_thinking).toBe(false);
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.ALIBABA_API_KEY;
      else process.env.ALIBABA_API_KEY = previous;
    }
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('refreshes authoritative context after partial repair while retaining validation feedback', async () => {
    let current = 'initial graph';
    mockedGenerateObject
      .mockResolvedValueOnce({ object: { value: 'partial' } } as never)
      .mockResolvedValueOnce({ object: { value: 'complete' } } as never);
    await runStoryAuthoringStage({} as never, {
      stage: 'structure',
      schema: z.object({ value: z.string() }),
      system: 'system',
      prompt: current,
      refreshPrompt: () => current,
      maxOutputTokens: 1024,
      timeoutMs: 1000,
      maxAttempts: 2,
      signal: new AbortController().signal,
      validate: (value) => {
        current = 'graph with accepted partial changes';
        return value.value === 'partial' ? ['one route still missing'] : [];
      },
    });
    expect(mockedGenerateObject.mock.calls[0][0].prompt).toBe('initial graph');
    expect(mockedGenerateObject.mock.calls[0][0].providerOptions).toEqual({
      alibaba: { enableThinking: false },
    });
    expect(mockedGenerateObject.mock.calls[1][0].prompt).toContain(
      'graph with accepted partial changes',
    );
    expect(mockedGenerateObject.mock.calls[1][0].prompt).toContain(
      'one route still missing',
    );
    expect(mockedGenerateObject.mock.calls[1][0].prompt).not.toContain(
      '<previous_answer>',
    );
    expect(mockedGenerateObject.mock.calls[1][0].prompt).toContain(
      'authoritative current state',
    );
  });

  it('reports output truncation and the actual parse cause instead of a long source preview', () => {
    const response = 'source preview '.repeat(500);
    const error = new NoObjectGeneratedError({
      message: 'Could not parse response',
      cause: new Error(
        `${response}Error message: Unexpected end of JSON input`,
      ),
      text: response,
      response: { id: 'truncated', timestamp: new Date(), modelId: 'test' },
      usage: {} as never,
      finishReason: 'length',
    });
    const diagnostic = describeModelError(error);
    expect(diagnostic).toContain('finishReason=length');
    expect(diagnostic).toContain(`responseChars=${response.length}`);
    expect(diagnostic).toContain('Unexpected end of JSON input');
    expect(diagnostic.length).toBeLessThan(1200);
  });

  it('shares repeated provider schema definitions while retaining every required field', async () => {
    const scene = z.object({ title: z.string() }).strict();
    mockedGenerateObject.mockResolvedValueOnce({
      object: { first: { title: 'A' }, second: { title: 'B' } },
    } as never);
    await runStoryAuthoringStage({} as never, {
      stage: 'structure',
      schema: z.object({ first: scene, second: scene }).strict(),
      system: 'system',
      prompt: 'prompt',
      maxOutputTokens: 1024,
      timeoutMs: 1000,
      maxAttempts: 1,
      signal: new AbortController().signal,
    });
    const request = mockedGenerateObject.mock.calls[0][0];
    expect(request.output).toBe('no-schema');
    const provider = JSON.parse(
      (request.system as string).split('conforming to this schema: ')[1],
    ) as {
      required: string[];
      properties: Record<string, { $ref: string }>;
      definitions: Record<string, unknown>;
    };
    expect(provider.required).toEqual(['first', 'second']);
    expect(provider.properties.first.$ref).toBe(
      provider.properties.second.$ref,
    );
    const name = provider.properties.first.$ref.replace('#/definitions/', '');
    expect(provider.definitions[name]).toMatchObject({
      type: 'object',
      required: ['title'],
      additionalProperties: false,
    });
  });

  it('repairs invalid JSON objects and applies Zod transforms before semantic validation', async () => {
    mockedGenerateObject
      .mockResolvedValueOnce({ object: { value: 123 } } as never)
      .mockResolvedValueOnce({ object: { value: '  valid  ' } } as never);
    const validate = jest.fn(() => []);
    const result = await runStoryAuthoringStage({} as never, {
      stage: 'structure',
      schema: z.object({ value: z.string().trim() }),
      system: 'system',
      prompt: 'source',
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxAttempts: 2,
      signal: new AbortController().signal,
      validate,
    });
    expect(result).toEqual({ value: 'valid' });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith({ value: 'valid' });
    expect(mockedGenerateObject.mock.calls[1][0].prompt).toContain('123');
    expect(mockedGenerateObject.mock.calls[1][0].prompt).toContain('value');
  });

  it('rejects schema-invalid JSON when its repair budget is exhausted', async () => {
    mockedGenerateObject.mockResolvedValue({ object: { value: 123 } } as never);
    const validate = jest.fn(() => []);
    await expect(
      runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'source',
        maxOutputTokens: 100,
        timeoutMs: 1000,
        maxAttempts: 2,
        signal: new AbortController().signal,
        validate,
      }),
    ).rejects.toThrow('exhausted 2 attempts');
    expect(validate).not.toHaveBeenCalled();
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('preserves the final deterministic validation failure after attempts are exhausted', async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { value: 'wrong' },
    } as never);

    const request = runStoryAuthoringStage({} as never, {
      stage: 'branch',
      schema: z.object({ value: z.string() }),
      system: 'system',
      prompt: 'prompt',
      maxOutputTokens: 1_024,
      timeoutMs: 1_000,
      maxAttempts: 2,
      signal: new AbortController().signal,
      validate: () => ['Node "ending" is unreachable once branches are wired.'],
    });

    await expect(request).rejects.toEqual(
      new StoryAuthoringStageError(
        'STORY_AGENT_STAGE_FAILED:branch',
        'The "branch" stage exhausted 2 attempts. Last failure: Node "ending" is unreachable once branches are wired.',
      ),
    );
  });

  it('includes the rejected structured answer and validation cause in the repair request', async () => {
    const invalid = '{"value":"opening"}';
    mockedGenerateObject
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          message: 'Invalid branch target',
          cause: new Error('nextNodeId must be ending'),
          text: invalid,
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'test',
          },
          usage: {} as never,
          finishReason: 'stop',
        }),
      )
      .mockResolvedValueOnce({ object: { value: 'ending' } } as never);
    await expect(
      runStoryAuthoringStage({} as never, {
        stage: 'branch',
        schema: z.object({ value: z.literal('ending') }),
        system: 'system',
        prompt: 'prompt',
        maxOutputTokens: 1024,
        timeoutMs: 1000,
        maxAttempts: 2,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ value: 'ending' });
    const secondCall = mockedGenerateObject.mock.calls[1]?.[0];
    expect(secondCall?.prompt).toContain(invalid);
    expect(secondCall?.prompt).toContain('nextNodeId must be ending');
  });

  it('preserves the final provider or schema error after attempts are exhausted', async () => {
    mockedGenerateObject.mockRejectedValue(
      new Error('structured output did not match the schema'),
    );

    const request = runStoryAuthoringStage({} as never, {
      stage: 'branch',
      schema: z.object({ value: z.string() }),
      system: 'system',
      prompt: 'prompt',
      maxOutputTokens: 1_024,
      timeoutMs: 1_000,
      maxAttempts: 2,
      signal: new AbortController().signal,
    });

    await expect(request).rejects.toEqual(
      new StoryAuthoringStageError(
        'STORY_AGENT_STAGE_FAILED:branch',
        'The "branch" stage exhausted 2 attempts. Last failure: structured output did not match the schema',
      ),
    );
  });

  it('retains structural repair context across a transport failure', async () => {
    mockedGenerateObject
      .mockResolvedValueOnce({ object: { value: 'wrong' } } as never)
      .mockRejectedValueOnce(new Error('Cannot connect to API: write EPIPE'))
      .mockResolvedValueOnce({ object: { value: 'ending' } } as never);

    await expect(
      runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'extract original source',
        maxOutputTokens: 1024,
        timeoutMs: 1000,
        maxAttempts: 3,
        signal: new AbortController().signal,
        validate: (value) =>
          value.value === 'ending' ? [] : ['Separate the ending at block 217.'],
      }),
    ).resolves.toEqual({ value: 'ending' });
    const repair = mockedGenerateObject.mock.calls[1]?.[0]?.prompt;
    expect(repair).toContain('Separate the ending at block 217.');
    expect(repair).toContain('{"value":"wrong"}');
    expect(mockedGenerateObject.mock.calls[2]?.[0]?.prompt).toBe(repair);
  });

  it('waits out provider throttling without burning the attempt budget', async () => {
    jest.useFakeTimers();
    try {
      mockedGenerateObject
        .mockRejectedValueOnce(
          new APICallError({
            url: 'https://maas.example/chat',
            statusCode: 429,
            isRetryable: true,
            requestBodyValues: {},
            message:
              'Allocated quota exceeded, please increase your quota limit. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#token-limit',
          }),
        )
        .mockResolvedValueOnce({ object: { value: 'ok' } } as never);
      const attempts: Array<[number, string, string?]> = [];
      const onAttempt = (
        attempt: number,
        outcome: 'ok' | 'error',
        detail?: string,
      ) => {
        attempts.push([attempt, outcome, detail]);
      };
      const request = runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'prompt',
        maxOutputTokens: 1_024,
        // A single attempt still survives one throttle window.
        maxAttempts: 1,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        onAttempt,
      });
      const settled = request.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
      // Still inside the first 15s backoff window.
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(await settled).toEqual({
        status: 'fulfilled',
        value: { value: 'ok' },
      });
      expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
      expect(attempts[0][1]).toBe('error');
      expect(attempts[0][2]).toContain('throttled by provider');
    } finally {
      jest.useRealTimers();
    }
  });

  it('detects quota rejections by message even outside API error status codes', async () => {
    jest.useFakeTimers();
    try {
      mockedGenerateObject
        .mockRejectedValueOnce(
          new Error(
            'Allocated quota exceeded, please increase your quota limit.',
          ),
        )
        .mockResolvedValueOnce({ object: { value: 'ok' } } as never);
      const request = runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'prompt',
        maxOutputTokens: 1_024,
        maxAttempts: 1,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      });
      const settled = request.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
      await jest.advanceTimersByTimeAsync(14_999);
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect((await settled).status).toBe('fulfilled');
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors the provider retry-after header instead of the default ladder', async () => {
    jest.useFakeTimers();
    try {
      mockedGenerateObject
        .mockRejectedValueOnce(
          new APICallError({
            url: 'https://maas.example/chat',
            statusCode: 429,
            isRetryable: true,
            requestBodyValues: {},
            responseHeaders: { 'retry-after-ms': '5000' },
            message: 'Allocated quota exceeded, please increase your quota.',
          }),
        )
        .mockResolvedValueOnce({ object: { value: 'ok' } } as never);
      const request = runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'prompt',
        maxOutputTokens: 1_024,
        maxAttempts: 1,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      });
      const settled = request.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
      // The default first wait would be 15s; 5s must be exactly enough.
      await jest.advanceTimersByTimeAsync(4_999);
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect((await settled).status).toBe('fulfilled');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops waiting after the bounded throttle budget and fails the attempt', async () => {
    jest.useFakeTimers();
    try {
      mockedGenerateObject.mockRejectedValue(
        new APICallError({
          url: 'https://maas.example/chat',
          statusCode: 429,
          isRetryable: true,
          requestBodyValues: {},
          message: 'Allocated quota exceeded, please increase your quota.',
        }),
      );
      const request = runStoryAuthoringStage({} as never, {
        stage: 'structure',
        schema: z.object({ value: z.string() }),
        system: 'system',
        prompt: 'prompt',
        maxOutputTokens: 1_024,
        maxAttempts: 1,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      });
      let rejection: unknown;
      const settled = request.catch((error: unknown) => {
        rejection = error;
      });
      await jest.advanceTimersByTimeAsync(15_000 + 30_000 + 60_000);
      await settled;
      expect(rejection).toBeInstanceOf(StoryAuthoringStageError);
      expect((rejection as Error).message).toContain('exhausted 1 attempts');
      // The original call plus one per bounded wait.
      expect(mockedGenerateObject).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });
});
