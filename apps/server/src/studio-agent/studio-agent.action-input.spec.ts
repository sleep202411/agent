import {
  STORY_PATCH_OPERATION_LABELS,
  StoryPatchActionInputSchema,
} from '@repo/shared/story-agent';
import type {
  StudioAgentCapabilityManifest,
  StudioAgentJsonObject,
  StudioAgentThreadScope,
} from '@repo/shared/studio-agent';
import { prepareStudioAgentActionInput } from './studio-agent.action-input';
import { StudioAgentRegistry } from './studio-agent.registry';

const RUN_ID = '019f9c10-0000-7000-8000-000000000001';
const STEP_ID = '019f9c10-0000-7000-8000-000000000002';
const TOOL_CALL_ID = 'call-apply-patch';
const PROJECT_ID = '019f9c10-0000-7000-8000-000000000003';
const CHAPTER_ID = '019f9c10-0000-7000-8000-000000000004';

const registry = new StudioAgentRegistry();

function patchCapability(): StudioAgentCapabilityManifest {
  return registry.capability({
    id: 'story.canvas.apply_patch',
    version: '1.0.0',
  });
}

function storyScope(
  overrides: Partial<StudioAgentThreadScope> = {},
): StudioAgentThreadScope {
  return {
    workspaceId: 'workspace-1',
    container: {
      resourceType: 'story.project',
      resourceId: PROJECT_ID,
      revision: null,
    },
    focus: {
      resourceType: 'story.chapter',
      resourceId: CHAPTER_ID,
      revision: null,
    },
    ...overrides,
  };
}

/** What the model emits once the manifest stops asking it for bookkeeping. */
function authoredInput(): StudioAgentJsonObject {
  return {
    baseDraftRevision: 4,
    baseLayoutRevision: 2,
    operations: [
      {
        kind: 'story_bible.update_overview',
        payload: { logline: 'A chef inherits a haunted kitchen.' },
      },
      {
        kind: 'story_graph.remove_node',
        payload: { nodeId: 'scene.opening' },
      },
    ],
  };
}

function prepare(
  input: StudioAgentJsonObject = authoredInput(),
  overrides: {
    scope?: StudioAgentThreadScope;
    toolCallId?: string;
  } = {},
): StudioAgentJsonObject {
  return prepareStudioAgentActionInput({
    capability: patchCapability(),
    scope: overrides.scope ?? storyScope(),
    runId: RUN_ID,
    stepId: STEP_ID,
    toolCallId: overrides.toolCallId ?? TOOL_CALL_ID,
    input,
  });
}

function operationsOf(input: StudioAgentJsonObject) {
  return input.operations as Array<Record<string, unknown>>;
}

describe('prepareStudioAgentActionInput', () => {
  it('completes a model input that carries no machine field at all', () => {
    const prepared = prepare();

    expect(prepared.projectId).toBe(PROJECT_ID);
    expect(prepared.chapterId).toBe(CHAPTER_ID);
    expect(
      operationsOf(prepared).map((operation) => operation.summary),
    ).toEqual([
      STORY_PATCH_OPERATION_LABELS['story_bible.update_overview'],
      STORY_PATCH_OPERATION_LABELS['story_graph.remove_node'],
    ]);
    // The authoritative parser is satisfied by an input the model never had to
    // guess at: every rejection recorded in production was one of these fields.
    expect(StoryPatchActionInputSchema.safeParse(prepared).success).toBe(true);
  });

  it('gives each operation in a batch its own id', () => {
    const ids = operationsOf(prepare()).map(
      (operation) => operation.operationId,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives the same ids when the gateway replays the same tool call', () => {
    // RuntimeGatewayClient re-POSTs identical bytes after a dropped connection
    // or a 502/503/504. A random id would change `inputHash`, and the replay
    // would hit STUDIO_AGENT_ACTION_IDEMPOTENCY_CONFLICT instead of the
    // already-prepared action.
    expect(prepare()).toEqual(prepare());
  });

  it('separates two tool calls in the same model step', () => {
    expect(operationsOf(prepare())[0]?.operationId).not.toBe(
      operationsOf(prepare(authoredInput(), { toolCallId: 'call-second' }))[0]
        ?.operationId,
    );
  });

  it('replaces anything the model volunteered for a machine field', () => {
    const volunteered = authoredInput();
    operationsOf(volunteered)[0] = {
      ...operationsOf(volunteered)[0],
      operationId: 'op-1',
      summary: 'Rewrite everything.',
    };
    volunteered.projectId = '019f9c10-0000-7000-8000-0000000000ff';

    const prepared = prepare(volunteered);

    // `op-1` is exactly the malformed uuid that used to fail a whole batch.
    expect(operationsOf(prepared)[0]?.operationId).not.toBe('op-1');
    expect(operationsOf(prepared)[0]?.summary).toBe(
      STORY_PATCH_OPERATION_LABELS['story_bible.update_overview'],
    );
    expect(prepared.projectId).toBe(PROJECT_ID);
    expect(
      registry.checkCapabilityInput(
        { id: 'story.canvas.apply_patch', version: '1.0.0' },
        prepared,
      ),
    ).toEqual({ ok: true, input: prepared });
  });

  it('leaves a structurally broken operation for the schema to report', () => {
    const broken: StudioAgentJsonObject = {
      baseDraftRevision: 4,
      baseLayoutRevision: 2,
      operations: [{ kind: 'story_graph.teleport_node', payload: {} }],
    };

    expect(operationsOf(prepare(broken))[0]).toEqual({
      kind: 'story_graph.teleport_node',
      payload: {},
    });
  });

  it('refuses a scope that cannot supply the ids it now owns', () => {
    expect(() =>
      prepare(authoredInput(), { scope: storyScope({ focus: null }) }),
    ).toThrow('project container and chapter focus');
  });

  it('leaves capabilities without server-supplied fields untouched', () => {
    const input: StudioAgentJsonObject = { resources: ['story.canvas'] };

    expect(
      prepareStudioAgentActionInput({
        capability: registry.capability({
          id: 'studio.context.read',
          version: '1.0.0',
        }),
        scope: storyScope(),
        runId: RUN_ID,
        stepId: STEP_ID,
        toolCallId: TOOL_CALL_ID,
        input,
      }),
    ).toBe(input);
  });
});
