import {
  assertStoryPatchProjectionFidelity,
  STORY_PATCH_OPERATION_KINDS,
  STORY_PATCH_PROJECTION_GAPS,
  StoryAgentGraphNodeSchema,
  STORY_PATCH_SERVER_SUPPLIED_ACTION_FIELDS,
  STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS,
  StoryPatchActionInputSchema,
  storyPatchActionInputJsonSchema,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';
import { findUnprojectableChecks } from '@repo/shared/zod-json-schema-fidelity';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { StudioAgentRegistry } from './studio-agent.registry';
import { anyString } from './__tests__/typed-expect';

describe('StudioAgentRegistry', () => {
  const registry = new StudioAgentRegistry();

  it('resolves one immutable scenario graph', () => {
    const scenario = registry.scenario({
      id: 'story.studio.assistant',
      version: '1.0.0',
    });

    expect(scenario.surfaceId).toBe('story.studio');
    expect(
      registry
        .scenarioCapabilities(scenario)
        .map((manifest) => manifest.capabilityId),
    ).toEqual([
      'studio.context.read',
      'story.canvas.read',
      'studio.task.delegate',
      'story.canvas.apply_patch',
    ]);
    expect(
      registry.scenarioSkills(scenario).map((manifest) => manifest.skillId),
    ).toEqual(['story.director']);
  });

  it('fails instead of substituting an unknown manifest version', () => {
    expect(() =>
      registry.scenario({
        id: 'story.studio.assistant',
        version: '2.0.0',
      }),
    ).toThrow('not registered');
  });

  it('refuses an input too large for the action row that must record it', () => {
    // A rejected input is persisted now, so one the column cannot hold would
    // fail its own INSERT — a 500 the runtime retries forever. Bounded at the
    // gate instead, where it is ordinary correctable feedback.
    const oversized = {
      resources: [`story.canvas.${'x'.repeat(1_048_577)}`],
    };

    const checked = registry.checkCapabilityInput(
      { id: 'studio.context.read', version: '1.0.0' },
      oversized,
    );

    expect(checked.ok).toBe(false);
    expect(checked.ok === false && checked.issues[0]?.message).toContain(
      'must serialize to at most 1048576 bytes',
    );
  });

  it('reports a strict capability-input rejection instead of throwing', () => {
    // Prepare has to be able to record the rejection as a failed action, so the
    // gate returns the issue paths rather than raising out of the request.
    expect(
      registry.checkCapabilityInput(
        { id: 'story.canvas.read', version: '1.0.0' },
        { unexpected: true },
      ),
    ).toEqual({
      ok: false,
      issues: [
        {
          path: 'unexpected',
          message: 'is not a field of this capability input',
        },
      ],
    });
    expect(() =>
      registry.requireCapabilityInput(
        { id: 'story.canvas.read', version: '1.0.0' },
        { unexpected: true },
      ),
    ).toThrow('unexpected');
  });

  it('validates strict capability outputs before an action is committed', () => {
    const reference = {
      id: 'story.canvas.apply_patch',
      version: '1.0.0',
    };
    const output = {
      projectId: '42f83588-2010-4c56-8659-a55c991dcd40',
      chapterId: 'd59bb772-d9ea-412d-83c0-62843b49445a',
      draftRevision: 4,
      layoutRevision: 7,
      draftChanged: true,
      layoutChanged: false,
      affectedNodeIds: ['scene.opening'],
      createdNodeIds: [],
    };

    expect(registry.validateCapabilityOutput(reference, output)).toEqual(
      output,
    );
    expect(() =>
      registry.validateCapabilityOutput(reference, {
        ...output,
        undocumented: true,
      }),
    ).toThrow('does not satisfy capability schema');
  });
});

const PATCH_CAPABILITY = {
  id: 'story.canvas.apply_patch',
  version: '1.0.0',
} as const;
const PROJECT_ID = '019f9b10-0000-7000-8000-000000000001';
const CHAPTER_ID = '019f9b10-0000-7000-8000-000000000002';
const OPERATION_ID = '019f9b10-0000-7000-8000-000000000003';

/**
 * One maximal payload per operation kind — every field the kind accepts,
 * optional ones included.
 *
 * "Maximal" is what makes the lockstep test below bite: the manifest closes
 * every object, so a field the projection forgot to declare shows up as a
 * rejection, and a field the projection wrongly demands shows up when it is
 * deleted. The fixtures are checked against the zod union in the same loop, so
 * they cannot quietly describe a contract the server does not have.
 */
const OPERATION_FIXTURES: ReadonlyArray<{
  kind: StoryPatchOperation['kind'];
  payload: Record<string, unknown>;
}> = [
  {
    kind: 'story_bible.update_overview',
    payload: {
      logline: 'A chef inherits a haunted kitchen.',
      synopsis: 'Three nights, three services, one ghost.',
    },
  },
  {
    kind: 'story_bible.put_character',
    payload: {
      intent: 'create',
      character: {
        id: 'char.chef',
        name: { 'en-US': 'The Chef' },
        summary: 'Inherits the kitchen and its debts.',
      },
    },
  },
  {
    kind: 'story_bible.remove_character',
    payload: { characterId: 'char.chef' },
  },
  {
    kind: 'story_graph.set_entry_node',
    payload: { nodeId: 'scene.opening' },
  },
  {
    kind: 'story_graph.put_node',
    payload: {
      intent: 'create',
      node: {
        kind: 'clip',
        nodeId: 'scene.opening',
        clipKey: 'OPENING',
        name: 'Opening service',
        description: 'The chef unlocks the door.',
        exit: {
          kind: 'choice',
          decisionId: 'decision.first-service',
          prompt: { 'en-US': 'Open the kitchen?' },
          choices: [
            {
              choiceId: 'choice.open',
              label: { 'en-US': 'Open it' },
              nextNodeId: 'scene.service',
            },
          ],
        },
      },
    },
  },
  {
    kind: 'story_graph.remove_node',
    payload: { nodeId: 'scene.opening' },
  },
  {
    kind: 'story_graph.reorder_nodes',
    payload: { nodeIds: ['scene.opening', 'scene.service'] },
  },
  {
    kind: 'production.replace_notes',
    payload: { productionNotes: ['Shoot the kitchen practical.'] },
  },
];

/** Exactly what a model is expected to emit: no server-supplied field anywhere. */
function authoredInput(operation: {
  kind: string;
  payload: Record<string, unknown>;
}) {
  return {
    baseDraftRevision: 4,
    baseLayoutRevision: 2,
    operations: [{ kind: operation.kind, payload: operation.payload }],
  };
}

/** The same call after `prepareStudioAgentActionInput` has filled it in. */
function preparedInput(operation: {
  kind: string;
  payload: Record<string, unknown>;
}) {
  const authored = authoredInput(operation);
  return {
    ...authored,
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    operations: authored.operations.map((entry) => ({
      ...entry,
      operationId: OPERATION_ID,
      summary: 'Server-generated label.',
    })),
  };
}

const patchRegistry = new StudioAgentRegistry();

function manifestAccepts(input: unknown): boolean {
  return patchRegistry.checkCapabilityInput(PATCH_CAPABILITY, input).ok;
}

describe('story.canvas.apply_patch manifest', () => {
  it('boots: the generated schema compiles under the registry validator', () => {
    // The registry compiles every manifest input schema in its constructor, so
    // a schema AJV refuses does not fail a request — it fails the pod.
    expect(() => new StudioAgentRegistry()).not.toThrow();

    const validator = new Ajv({
      allErrors: true,
      allowUnionTypes: true,
      strict: true,
      validateFormats: true,
    });
    addFormats(validator);
    expect(() =>
      validator.compile(storyPatchActionInputJsonSchema()),
    ).not.toThrow();
  });

  it('ships a self-contained document the tool layer can serialise', () => {
    const schema = storyPatchActionInputJsonSchema();
    const serialised = JSON.stringify(schema);

    // `$ref`/`$defs` would have to be resolved by whatever hands the schema to
    // the provider, and a `$schema` at the root is an unresolvable meta-schema
    // reference for AJV's default draft-07 environment.
    expect(serialised).not.toContain('$ref');
    expect(serialised).not.toContain('$defs');
    expect(schema.$schema).toBeUndefined();
    expect(JSON.parse(serialised)).toEqual(schema);
  });

  it('advertises every operation kind the zod union validates', () => {
    const branches = advertisedOperationBranches();

    expect(branches.map((branch) => branch.kind).sort()).toEqual(
      [...STORY_PATCH_OPERATION_KINDS].sort(),
    );
    expect(OPERATION_FIXTURES.map((fixture) => fixture.kind).sort()).toEqual(
      [...STORY_PATCH_OPERATION_KINDS].sort(),
    );
  });

  it.each(
    OPERATION_FIXTURES.map((fixture) => [fixture.kind, fixture] as const),
  )('describes %s in lockstep with the zod union', (_kind, fixture) => {
    // Both layers accept the maximal payload: nothing the contract allows is
    // missing from the projection, and the fixture is not fiction.
    expect(manifestAccepts(authoredInput(fixture))).toBe(true);
    expect(
      StoryPatchActionInputSchema.safeParse(preparedInput(fixture)).success,
    ).toBe(true);

    // Field by field, the two layers agree on what is mandatory. A manifest
    // that under-describes a payload lets a doomed call through; one that
    // over-describes it rejects a legal call.
    for (const field of Object.keys(fixture.payload)) {
      const payload = { ...fixture.payload };
      delete payload[field];
      const trimmed = { kind: fixture.kind, payload };
      expect({
        field,
        manifest: manifestAccepts(authoredInput(trimmed)),
      }).toEqual({
        field,
        manifest: StoryPatchActionInputSchema.safeParse(preparedInput(trimmed))
          .success,
      });
    }
  });

  it('does not ask the model for a single server-supplied field', () => {
    const schema = advertisedInputSchema();
    const required = schema.required as string[];
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;

    for (const field of Object.keys(
      STORY_PATCH_SERVER_SUPPLIED_ACTION_FIELDS,
    )) {
      // Declared but optional: the persisted input is re-validated against this
      // same closed schema at execute time, so the field cannot be dropped.
      expect(required).not.toContain(field);
      expect(properties[field]).toBeDefined();
      expect(properties[field]?.description).toEqual(anyString());
    }
    for (const branch of advertisedOperationBranches()) {
      for (const field of Object.keys(
        STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS,
      )) {
        expect(branch.required).not.toContain(field);
        expect(branch.properties[field]).toBeDefined();
      }
      expect(branch.required).toContain('kind');
      expect(branch.required).toContain('payload');
    }
  });

  it.each(
    OPERATION_FIXTURES.map((fixture) => [fixture.kind, fixture] as const),
  )(
    'accepts %s with and without the server-supplied fields',
    (_kind, fixture) => {
      expect(manifestAccepts(authoredInput(fixture))).toBe(true);
      // Round trip: whatever prepare persists has to survive the execute-time
      // re-validation against the identical schema.
      expect(manifestAccepts(preparedInput(fixture))).toBe(true);
    },
  );
});

/** What the registry actually publishes, not what the generator would produce. */
function advertisedInputSchema(): Record<string, unknown> {
  return patchRegistry.capability(PATCH_CAPABILITY).inputSchema as Record<
    string,
    unknown
  >;
}

function advertisedOperationBranches(): Array<{
  kind: string;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
}> {
  const schema = advertisedInputSchema();
  const operations = (
    schema.properties as Record<string, Record<string, unknown>>
  ).operations;
  const items = operations.items as Record<string, unknown>;
  const branches = items.anyOf as Array<Record<string, unknown>>;
  return branches.map((branch) => {
    const properties = branch.properties as Record<
      string,
      Record<string, unknown>
    >;
    return {
      kind: properties.kind?.const as string,
      required: branch.required as string[],
      properties,
    };
  });
}

/**
 * The projection audit: does the generated document say the same thing as the
 * zod union it claims to project, for every branch and every nested variant?
 *
 * `storyPatchActionInputJsonSchema` and the manifest built from it landed with no
 * review while every `apply_patch` already flowed through them, and the manifest
 * is the ONLY contract the model is given. A projection that under-describes a
 * payload invites a call the executor will reject; one that over-describes it
 * refuses a legal call. Both now cost a correction from a bounded budget, so
 * neither is cheap.
 *
 * The tests below are differential on purpose: nothing here restates the
 * contract. Every expectation is "the two layers agree", and the branch
 * inventories are read off the zod schemas, so a union that gains a branch fails
 * these tests instead of shipping unadvertised.
 */
/** Every node kind and every exit kind, read off the schema that validates. */
const NODE_KINDS = [StoryAgentGraphNodeSchema.shape.kind.value];
const EXIT_KINDS = StoryAgentGraphNodeSchema.shape.exit.options.map(
  (exit) => exit.shape.kind.value,
);

const EXIT_FIXTURES: Record<string, Record<string, unknown>> = {
  auto: { kind: 'auto', nextNodeId: 'scene.service' },
  choice: {
    kind: 'choice',
    decisionId: 'decision.first-service',
    prompt: { 'en-US': 'Open the kitchen?' },
    choices: [
      {
        choiceId: 'choice.open',
        label: { 'en-US': 'Open it' },
        nextNodeId: 'scene.service',
      },
    ],
  },
};

/** One maximal node per kind, with its exit left to the caller. */
function nodeFixture(
  kind: string,
  exit: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    kind === 'clip'
      ? {
          kind: 'clip',
          nodeId: 'scene.opening',
          clipKey: 'OPENING',
          name: 'Opening service',
          description: 'The chef unlocks the door.',
        }
      : undefined;
  if (!base) {
    throw new Error(
      `The zod node union gained the kind "${kind}" and this spec has no maximal fixture for it. Add one — the projection is only proven for the variants exercised here.`,
    );
  }
  return { ...base, exit };
}

/** Like `authoredInput`, but preserves keys the operation should not have. */
function authoredOperation(operation: Record<string, unknown>) {
  return {
    baseDraftRevision: 4,
    baseLayoutRevision: 2,
    operations: [operation],
  };
}

function putNodeInput(node: Record<string, unknown>) {
  return authoredInput({
    kind: 'story_graph.put_node',
    payload: { intent: 'create', node },
  });
}

/** Every deletable path in a JSON value, deepest paths included. */
function deletablePaths(value: unknown, prefix: string[] = []): string[][] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      deletablePaths(entry, [...prefix, String(index)]),
    );
  }
  return Object.entries(value).flatMap(([key, entry]) => [
    [...prefix, key],
    ...deletablePaths(entry, [...prefix, key]),
  ]);
}

function withoutPath<T>(value: T, path: string[]): T {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let cursor: Record<string, unknown> | undefined = clone;
  for (const segment of path.slice(0, -1)) {
    cursor = cursor?.[segment] as Record<string, unknown> | undefined;
    if (!cursor) return clone as T;
  }
  const last = path.at(-1);
  if (cursor && last !== undefined) {
    if (Array.isArray(cursor)) {
      (cursor as unknown[]).splice(Number(last), 1);
    } else {
      delete cursor[last];
    }
  }
  return clone as T;
}

/** The one question worth asking: do both gates reach the same verdict? */
function agreementOn(input: unknown): { manifest: boolean; zod: boolean } {
  return {
    manifest: manifestAccepts(input),
    zod: StoryPatchActionInputSchema.safeParse(withServerFields(input)).success,
  };
}

/** The server fills these in before either gate runs; the fixtures do not. */
function withServerFields(input: unknown): unknown {
  const cloned = JSON.parse(JSON.stringify(input)) as {
    operations?: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
  cloned.projectId = PROJECT_ID;
  cloned.chapterId = CHAPTER_ID;
  if (Array.isArray(cloned.operations)) {
    cloned.operations = cloned.operations.map((operation) =>
      operation !== null && typeof operation === 'object'
        ? {
            ...operation,
            operationId: OPERATION_ID,
            summary: 'Server-generated label.',
          }
        : operation,
    );
  }
  return cloned;
}

describe('story.canvas.apply_patch projection ↔ zod union', () => {
  it('advertises every nested variant the zod union validates', () => {
    const branches = advertisedOperationBranches();
    const putNode = branches.find(
      (branch) => branch.kind === 'story_graph.put_node',
    );
    const projectedNode = (
      (putNode?.properties.payload as Record<string, unknown>)
        .properties as Record<string, Record<string, unknown>>
    ).node;
    const nodeBranches = Array.isArray(projectedNode.anyOf)
      ? (projectedNode.anyOf as Array<Record<string, unknown>>)
      : [projectedNode];
    const advertisedNodeKinds = nodeBranches.map(
      (branch) =>
        (branch.properties as Record<string, Record<string, unknown>>).kind
          .const as string,
    );
    const advertisedExitKinds = new Set(
      nodeBranches.flatMap((branch) =>
        (
          ((branch.properties as Record<string, Record<string, unknown>>).exit
            .anyOf as Array<Record<string, unknown>>) ?? []
        ).map(
          (exit) =>
            (exit.properties as Record<string, Record<string, unknown>>).kind
              .const as string,
        ),
      ),
    );

    expect(advertisedNodeKinds.sort()).toEqual([...NODE_KINDS].sort());
    expect([...advertisedExitKinds].sort()).toEqual([...EXIT_KINDS].sort());
    // Fixture coverage is part of the contract: a new branch with no maximal
    // fixture is a branch nothing below actually checks.
    expect(Object.keys(EXIT_FIXTURES).sort()).toEqual([...EXIT_KINDS].sort());
    for (const kind of NODE_KINDS) {
      expect(() => nodeFixture(kind, EXIT_FIXTURES.auto)).not.toThrow();
    }
  });

  it.each(
    NODE_KINDS.flatMap((nodeKind) =>
      EXIT_KINDS.map(
        (exitKind) =>
          [
            `${nodeKind} node with a ${exitKind} exit`,
            nodeKind,
            exitKind,
          ] as const,
      ),
    ),
  )('agrees on a %s', (_label, nodeKind, exitKind) => {
    // A missing fixture is already a failure of the coverage assertion above,
    // so this lookup does not need to re-assert its own result.
    const node = nodeFixture(nodeKind, EXIT_FIXTURES[exitKind]);
    expect(agreementOn(putNodeInput(node))).toEqual({
      manifest: true,
      zod: true,
    });

    // Field by field, at every depth: the same verdict on the same document.
    for (const path of deletablePaths(node)) {
      const verdict = agreementOn(putNodeInput(withoutPath(node, path)));
      expect({ path: path.join('.'), ...verdict }).toEqual({
        path: path.join('.'),
        manifest: verdict.zod,
        zod: verdict.zod,
      });
    }
  });

  it.each(
    OPERATION_FIXTURES.map((fixture) => [fixture.kind, fixture] as const),
  )('agrees on every field of %s at every depth', (_kind, fixture) => {
    for (const path of deletablePaths(fixture.payload)) {
      const mutated = {
        kind: fixture.kind,
        payload: withoutPath(fixture.payload, path),
      };
      const verdict = agreementOn(authoredInput(mutated));
      expect({ path: path.join('.'), ...verdict }).toEqual({
        path: path.join('.'),
        manifest: verdict.zod,
        zod: verdict.zod,
      });
    }
  });

  it.each([
    [
      'a kind that does not exist',
      { kind: 'story_graph.teleport_node', payload: {} },
    ],
    [
      'a node kind that does not exist',
      {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'world',
            nodeId: 'scene.a',
            exit: { kind: 'auto', nextNodeId: null },
          },
        },
      },
    ],
    [
      'an exit kind that does not exist',
      {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: 'scene.a',
            clipKey: 'A',
            exit: { kind: 'router', nextNodeId: null },
          },
        },
      },
    ],
    [
      'an extra key on an operation',
      {
        kind: 'story_graph.remove_node',
        payload: { nodeId: 'scene.a' },
        note: 'undeclared',
      },
    ],
    [
      'a choice list past its ceiling',
      {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: 'scene.a',
            clipKey: 'A',
            exit: {
              ...EXIT_FIXTURES.choice,
              choices: Array.from({ length: 7 }, (_, index) => ({
                choiceId: `choice.${index}`,
                label: { 'en-US': 'l' },
                nextNodeId: 'scene.b',
              })),
            },
          },
        },
      },
    ],
    [
      'an overview with no field set',
      { kind: 'story_bible.update_overview', payload: {} },
    ],
  ])('agrees on rejecting %s', (_label, operation) => {
    expect(
      agreementOn(authoredOperation(operation as Record<string, unknown>)),
    ).toEqual({
      manifest: false,
      zod: false,
    });
  });

  it('agrees on the aggregate operation-list bounds', () => {
    const operation = {
      kind: 'story_graph.remove_node',
      payload: { nodeId: 'scene.opening' },
    };
    const list = (count: number) => ({
      baseDraftRevision: 4,
      baseLayoutRevision: 2,
      operations: Array.from({ length: count }, () => operation),
    });

    expect(agreementOn(list(0))).toEqual({ manifest: false, zod: false });
    expect(agreementOn(list(1))).toEqual({ manifest: true, zod: true });
    expect(agreementOn(list(100))).toEqual({ manifest: true, zod: true });
    expect(agreementOn(list(101))).toEqual({ manifest: false, zod: false });
    // The recorded live failure: `operations` sent as an object.
    expect(
      agreementOn({
        baseDraftRevision: 4,
        baseLayoutRevision: 2,
        operations: operation,
      }),
    ).toEqual({ manifest: false, zod: false });
  });

  /**
   * The one asymmetry the projection cannot remove, pinned by direction.
   *
   * `.trim()` is a transform, so zod judges a normalized string while the
   * projection can only describe the raw one. The manifest may therefore be
   * STRICTER on whitespace padding — which is safe, and better feedback than a
   * silent normalization. It must never be LAXER: that would mean prepare
   * accepting a call the executor then rejects, spending a correction on a
   * mistake the model was told was fine. The two cases that were laxer are
   * fixed at the source (localized-text keys are no longer trimmed, and the
   * operation summary carries a `\S` pattern).
   */
  it.each([
    [
      'a padded stable id',
      {
        kind: 'story_graph.remove_node',
        payload: { nodeId: ' scene.opening ' },
      },
    ],
    [
      'a padded clip key',
      {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: 'scene.a',
            clipKey: ' A ',
            exit: { kind: 'auto', nextNodeId: null },
          },
        },
      },
    ],
    [
      'a whitespace-only localized-text key',
      {
        kind: 'story_bible.put_character',
        payload: {
          intent: 'create',
          character: { id: 'char.a', name: { '  ': 'A' }, summary: 's' },
        },
      },
    ],
    [
      'a padded localized-text key',
      {
        kind: 'story_bible.put_character',
        payload: {
          intent: 'create',
          character: { id: 'char.a', name: { ' en-US ': 'A' }, summary: 's' },
        },
      },
    ],
  ])('is never laxer than the executor about %s', (_label, operation) => {
    const verdict = agreementOn(
      authoredOperation(operation as Record<string, unknown>),
    );

    expect(verdict.manifest && !verdict.zod).toBe(false);
  });

  it('is never laxer than the executor about a whitespace-only summary', () => {
    // `summary` is server-supplied on the capability path, so this pair is only
    // reachable through the execute-time re-validation of a persisted input and
    // through the deterministic authoring pipeline, which shares the union. The
    // projection carries a `\S` pattern precisely so `minLength: 1` cannot
    // accept a label that zod rejects the moment it trims it.
    const persisted = {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      baseDraftRevision: 4,
      baseLayoutRevision: 2,
      operations: [
        {
          kind: 'story_graph.remove_node',
          operationId: OPERATION_ID,
          summary: '   ',
          payload: { nodeId: 'scene.opening' },
        },
      ],
    };

    expect({
      manifest: manifestAccepts(persisted),
      zod: StoryPatchActionInputSchema.safeParse(persisted).success,
    }).toEqual({ manifest: false, zod: false });
  });

  it('leaves only the complexity ceilings to the executor', () => {
    // JSON Schema cannot express a serialized-byte budget, so the Story
    // complexity ceiling (512 KiB) stays in the executor's zod gate. The window
    // is narrow — the manifest gate refuses anything past 1 MiB, because it has
    // to fit the action row that records the rejection — but it is real, and
    // pinned rather than papered over: inside it the rejection still has to be
    // the correctable kind, naming the offending path.
    const oversized = {
      baseDraftRevision: 4,
      baseLayoutRevision: 2,
      operations: Array.from({ length: 30 }, () => ({
        kind: 'story_bible.update_overview',
        payload: { synopsis: 'x'.repeat(20_000) },
      })),
    };

    expect(agreementOn(oversized)).toEqual({ manifest: true, zod: false });
    const rejection = StoryPatchActionInputSchema.safeParse(
      withServerFields(oversized),
    );
    expect(rejection.success).toBe(false);
    expect(rejection.error?.issues[0]?.message).toContain(
      'STORY_PATCH_INPUT_TOO_COMPLEX',
    );
  });
});

describe('story.canvas.apply_patch rejection feedback', () => {
  function issuesFor(input: unknown) {
    const checked = patchRegistry.checkCapabilityInput(PATCH_CAPABILITY, input);
    if (checked.ok) throw new Error('The input was supposed to be rejected.');
    return checked.issues;
  }

  it('names the field the model got wrong, once', () => {
    // The observed live rejection. One issue, one path, no branch noise.
    expect(
      issuesFor({
        baseDraftRevision: 4,
        baseLayoutRevision: 2,
        operations: { kind: 'story_bible.update_overview', payload: {} },
      }),
    ).toEqual([{ path: 'operations', message: 'must be array' }]);
  });

  it('collapses a closed union into the list of kinds it accepts', () => {
    // Ten branches reject an unknown kind, nine of them for the kind they are
    // not. A model reading "must be equal to constant" ten times learns nothing.
    const issues = issuesFor(
      authoredInput({ kind: 'story_graph.teleport_node', payload: {} }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('operations.0.kind');
    for (const kind of STORY_PATCH_OPERATION_KINDS) {
      expect(issues[0]?.message).toContain(kind);
    }
  });

  it('reports the branch the model actually addressed', () => {
    const issues = issuesFor(
      authoredInput({
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: 'scene.a',
            exit: { kind: 'auto', nextNodeId: null },
          },
        },
      }),
    );

    expect(issues).toEqual([
      {
        path: 'operations.0.payload.node.clipKey',
        message: 'is required',
      },
    ]);
  });

  it('keeps two operations' + ' verdicts apart', () => {
    // Branch selection is per instance: a valid first operation must not rescue
    // a second one that named a kind nothing accepts.
    const issues = issuesFor({
      baseDraftRevision: 4,
      baseLayoutRevision: 2,
      operations: [
        { kind: 'story_graph.remove_node', payload: { nodeId: 'scene.a' } },
        { kind: 'story_graph.teleport_node', payload: {} },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('operations.1.kind');
  });
});

/**
 * The drift suite above proves the two gates agree on STRUCTURE. It cannot see
 * a zod check the projection drops, because a dropped check leaves no trace in
 * the document it compares. These cover the guard that does.
 */
describe('story.canvas.apply_patch projection fidelity guard', () => {
  it('accepts the shipped schema, so the projection is emitted at all', () => {
    expect(() => assertStoryPatchProjectionFidelity()).not.toThrow();
    expect(() => storyPatchActionInputJsonSchema()).not.toThrow();
  });

  it('refuses a refinement JSON Schema cannot carry, naming where it sits', () => {
    // The dangerous direction: `.refine` vanishes from the projection, so the
    // model is told the payload is acceptable and the executor then refuses it.
    const drifted = StoryPatchActionInputSchema.refine(
      (input) => input.baseDraftRevision !== input.baseLayoutRevision,
    );

    expect(() => assertStoryPatchProjectionFidelity(drifted)).toThrow(
      /cannot express 1 zod check\(s\).*\$ \(custom\)/s,
    );
  });

  it('will not let one acknowledgement cover a SECOND check of the same kind', () => {
    // The hole this closes: acknowledgements used to be matched by (schema,
    // check KIND) membership, so a schema whose single `.refine` was already
    // accounted for could quietly grow a second one and still project. That is
    // the exact silent divergence the guard exists to prevent, one level up.
    const once = StoryPatchActionInputSchema.refine(
      (input) => input.baseDraftRevision !== input.baseLayoutRevision,
    );
    const twice = once.refine((input) => input.baseDraftRevision >= 0);

    // `twice` is ONE schema object carrying TWO custom checks (zod accumulates
    // them onto the clone). A single acknowledgement for it must cover exactly
    // one of them — set-membership matching covered both, which is the hole.
    const gaps = [
      ...STORY_PATCH_PROJECTION_GAPS,
      {
        schema: twice as unknown as object,
        check: 'custom',
        reason: 'test fixture: covers exactly one of the two',
      },
    ];

    expect(() => assertStoryPatchProjectionFidelity(twice, gaps)).toThrow(
      /cannot express 1 zod check\(s\)/s,
    );
  });

  it('finds an unprojectable check nested behind a union, an array and an optional', () => {
    // A refinement six levels down is the realistic case, and the reported path
    // has to be specific enough to find it: union arms are named by their own
    // discriminator so the name survives a tenth operation kind landing.
    const nested = z.object({
      operations: z.array(
        z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('story_graph.put_node'),
              choices: z
                .array(
                  z
                    .object({ choiceId: z.string(), nextNodeId: z.string() })
                    .refine((choice) => choice.choiceId !== choice.nextNodeId),
                )
                .optional(),
            })
            .strict(),
        ]),
      ),
    });

    expect(
      findUnprojectableChecks(nested).map(
        (found) => `${found.path} ${found.check}`,
      ),
    ).toEqual(['$.operations[]<story_graph.put_node>.choices[] custom']);
  });

  it('reports a `.trim()` rewrite, not only a refinement', () => {
    // `.trim()` makes zod judge a normalized string while the projection
    // describes the raw one. Harmless where the projected pattern is stricter,
    // a live defect where it is not — either way the guard must see it.
    expect(
      findUnprojectableChecks(
        z.object({ label: z.string().trim().min(1) }),
      ).map((found) => `${found.path} ${found.check}`),
    ).toEqual(['$.label overwrite']);
  });

  it('leaves the bounds JSON Schema does express alone', () => {
    expect(
      findUnprojectableChecks(
        z.object({
          name: z.string().min(1).max(4).regex(/^a/),
          count: z.number().int().nonnegative(),
          items: z.array(z.uuid()).max(6),
        }),
      ),
    ).toEqual([]);
  });

  it('rejects an acknowledgement the schema no longer carries', () => {
    // A stale entry is how the list stops describing reality and starts being
    // skimmed, which is the failure mode a written argument exists to prevent.
    const stale = [
      ...STORY_PATCH_PROJECTION_GAPS,
      {
        schema: z.string().trim(),
        check: 'overwrite',
        reason: 'Belongs to no schema this projection reaches.',
      },
    ];

    expect(() =>
      assertStoryPatchProjectionFidelity(StoryPatchActionInputSchema, stale),
    ).toThrow(/acknowledges 1 check\(s\) the schema no longer carries/);
  });

  it('accounts for every unprojectable check the shipped schema carries', () => {
    // Both directions in one assertion: nothing found is unaccounted for, and
    // nothing accounted for is missing.
    expect(() =>
      assertStoryPatchProjectionFidelity(
        StoryPatchActionInputSchema,
        STORY_PATCH_PROJECTION_GAPS,
      ),
    ).not.toThrow();
    expect(
      findUnprojectableChecks(StoryPatchActionInputSchema).length,
    ).toBeGreaterThan(0);
    for (const gap of STORY_PATCH_PROJECTION_GAPS) {
      expect(gap.reason.length).toBeGreaterThan(40);
    }
  });
});
