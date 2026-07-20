import {
  STORY_PATCH_COMPLEXITY_LIMITS,
  assertStoryPatchComplexity,
  StoryPatchOperationsSchema,
  StoryPatchPreflightError,
} from '@repo/shared/story-agent';

describe('Story patch iterative complexity preflight', () => {
  it.each([
    {
      label: 'serialized bytes',
      value: () => 'x'.repeat(STORY_PATCH_COMPLEXITY_LIMITS.serializedBytes),
      metric: 'serializedBytes',
    },
    {
      label: 'aggregate array items',
      value: () =>
        Array.from(
          { length: STORY_PATCH_COMPLEXITY_LIMITS.arrayItems + 1 },
          () => null,
        ),
      metric: 'arrayItems',
    },
    {
      label: 'aggregate containers',
      value: () =>
        Array.from(
          { length: STORY_PATCH_COMPLEXITY_LIMITS.containers + 1 },
          () => ({}),
        ),
      metric: 'containers',
    },
  ])('rejects payloads beyond the $label limit', ({ value, metric }) => {
    const error = capturePreflightError(() =>
      assertStoryPatchComplexity(value()),
    );

    expect(error).toMatchObject({
      code: 'STORY_PATCH_INPUT_TOO_COMPLEX',
      metric,
    });
  });

  it('rejects circular and non-JSON input with a structured code', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      capturePreflightError(() => assertStoryPatchComplexity(circular)),
    ).toMatchObject({ code: 'STORY_PATCH_INPUT_NOT_JSON' });
  });

  it('guards the exported Zod operation-list schema before recursive parsing', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 5_000; depth += 1) {
      deep = { nested: deep };
    }
    const result = StoryPatchOperationsSchema.safeParse([
      {
        operationId: '0197f4a2-0800-7000-8000-000000000123',
        summary: 'Deeply nested payload.',
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: deep,
        },
      },
    ]);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected schema rejection.');
    expect(result.error.issues[0]?.message).toContain(
      'STORY_PATCH_INPUT_TOO_COMPLEX',
    );
  });
});

function capturePreflightError(run: () => unknown): StoryPatchPreflightError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StoryPatchPreflightError);
  if (!(thrown instanceof StoryPatchPreflightError)) {
    throw new Error('Expected StoryPatchPreflightError.');
  }
  return thrown;
}
