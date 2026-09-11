import { generateObject, NoObjectGeneratedError } from 'ai';
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
  it('sends strict JSON Schema through the actual Alibaba provider transport', async () => {
    const previous = process.env.ALIBABA_API_KEY;
    process.env.ALIBABA_API_KEY = 'unit-test-key';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'fixture',
            created: 1,
            model: 'fixture',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"value":"ok"}' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      const model = createStoryAuthoringModel();
      if (typeof model === 'string') throw new Error('Expected provider model');
      await model.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Return the fixture.' }],
          },
        ],
        responseFormat: {
          type: 'json',
          schema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
        maxOutputTokens: 32,
        providerOptions: { alibaba: { enableThinking: false } },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as {
        response_format: { json_schema: { strict: boolean } };
        max_tokens: number;
        enable_thinking: boolean;
      };
      expect(body.response_format.json_schema.strict).toBe(true);
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
    if (!('schema' in request)) throw new Error('Missing provider schema');
    const wrapper = request.schema as {
      jsonSchema: {
        required: string[];
        properties: Record<string, { $ref: string }>;
        definitions: Record<string, unknown>;
      };
    };
    const provider = wrapper.jsonSchema;
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
});
