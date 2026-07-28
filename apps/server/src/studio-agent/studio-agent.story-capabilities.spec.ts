import { StoryPatchActionInputSchema } from '@repo/shared/story-agent';
import type { Prisma } from '@prisma/client';
import type { StoryPermissionService } from '../story-studio/story-permission.service';
import type { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { StudioAgentCapabilityInputError } from './studio-agent.capability-error';
import { StudioAgentStoryCapabilities } from './studio-agent.story-capabilities';

const PROJECT_ID = '019f9a10-0000-7000-8000-000000000005';
const CHAPTER_ID = '019f9a10-0000-7000-8000-000000000006';

/**
 * Input attribution at the adapter boundary.
 *
 * The executor can only tell "the model sent bad input" apart from "our own
 * result code threw" if the adapters raise the distinction explicitly, and the
 * end-to-end proof of that lives one layer up. Everything below the input parse
 * is unreachable here on purpose: the transaction client throws on any use, so
 * these tests also pin the ordering — a malformed input is refused before the
 * adapter touches the database, let alone writes.
 *
 * A revert of `parseCapabilityInput` back to `schema.parse` passes every other
 * studio-agent spec, because they all replace the adapter with a `jest.Mock`.
 * This file is what fails.
 */
describe('StudioAgentStoryCapabilities input attribution', () => {
  it('attributes a malformed patch input to the input, before any database work', async () => {
    const { capabilities, transaction } = harness();

    await expect(
      capabilities.applyPatch(transaction, storyContext(malformedPatchInput())),
    ).rejects.toBeInstanceOf(StudioAgentCapabilityInputError);
    expect(() =>
      StoryPatchActionInputSchema.parse(malformedPatchInput()),
    ).toThrow();
  });

  it('carries the failing issue paths so the executor can render them', async () => {
    const { capabilities, transaction } = harness();

    const error = await capabilities
      .applyPatch(transaction, storyContext(malformedPatchInput()))
      .then(
        () => null,
        (rejection: unknown) => rejection,
      );

    expect(error).toBeInstanceOf(StudioAgentCapabilityInputError);
    expect(
      (error as StudioAgentCapabilityInputError).issues.map(
        (issue) => issue.path,
      ),
    ).toContain('operations.0.payload.intent');
  });

  it('attributes an unexpected key on a read input to the input', async () => {
    const { capabilities, transaction } = harness();

    await expect(
      capabilities.readCanvas(
        transaction,
        storyContext({ unexpected: 'never declared' }),
      ),
    ).rejects.toBeInstanceOf(StudioAgentCapabilityInputError);
  });
});

function harness() {
  const capabilities = new StudioAgentStoryCapabilities(
    {} as StoryPermissionService,
    {} as StoryProjectWriteGuardService,
  );
  return { capabilities, transaction: unusableTransaction() };
}

/** Any database access before the input is validated is a test failure. */
function unusableTransaction(): Prisma.TransactionClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `The adapter touched the transaction (${String(property)}) before validating its input.`,
        );
      },
    },
  ) as Prisma.TransactionClient;
}

function storyContext(input: Prisma.JsonObject) {
  return {
    actorId: 'actor-1',
    action: {
      id: '019f9a10-0000-7000-8000-000000000003',
      threadId: '019f9a10-0000-7000-8000-000000000001',
      runId: '019f9a10-0000-7000-8000-000000000002',
      title: 'Replace the opening scene',
      summary: 'Replace the opening scene with a rainy-night prologue.',
      input,
    },
    rawScopeContainer: {
      resourceType: 'story.project',
      resourceId: PROJECT_ID,
      revision: null,
    },
    rawScopeFocus: {
      resourceType: 'story.chapter',
      resourceId: CHAPTER_ID,
      revision: null,
    },
    workspaceId: 'workspace-1',
  };
}

/** The input the model actually sent the day this contract was hardened. */
function malformedPatchInput() {
  return {
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    baseDraftRevision: 67,
    baseLayoutRevision: 12,
    operations: [
      {
        kind: 'story_graph.put_node',
        operationId: 'op-1',
        summary: 'Replace the opening scene.',
        payload: {
          intent: 'overwrite',
          node: { title: 'A new opening', content: 'The chef arrives.' },
        },
      },
    ],
  };
}
