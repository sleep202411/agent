import { generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import {
  runStoryAuthoringStage,
  StoryAuthoringStageError,
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
  beforeEach(() => {
    jest.clearAllMocks();
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
});
