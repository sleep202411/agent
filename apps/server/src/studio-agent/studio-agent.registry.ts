import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentJsonObjectSchema,
  StudioAgentCapabilityManifestSchema,
  StudioAgentScenarioManifestSchema,
  StudioAgentSkillManifestSchema,
  type StudioAgentCapabilityManifest,
  type StudioAgentJsonObject,
  type StudioAgentJsonValue,
  type StudioAgentManifestRef,
  type StudioAgentScenarioManifest,
  type StudioAgentSkillManifest,
} from '@repo/shared/studio-agent';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

const OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
} as const;

const MANIFEST_REF_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: ['id', 'version'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 },
    version: { type: 'string', minLength: 1, maxLength: 64 },
  },
};

const RESOURCE_REF_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: ['resourceType', 'resourceId', 'revision'],
  properties: {
    resourceType: { type: 'string', minLength: 1, maxLength: 160 },
    resourceId: { type: 'string', minLength: 1, maxLength: 256 },
    revision: { type: ['string', 'null'], minLength: 1, maxLength: 160 },
  },
};

const STUDIO_CONTEXT_OUTPUT_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: [
    'surfaceId',
    'scenario',
    'scope',
    'locale',
    'capabilities',
    'skills',
  ],
  properties: {
    surfaceId: { type: 'string', minLength: 1, maxLength: 160 },
    scenario: MANIFEST_REF_SCHEMA,
    scope: {
      ...OBJECT_SCHEMA,
      required: ['workspaceId', 'container', 'focus'],
      properties: {
        workspaceId: { type: 'string', format: 'uuid' },
        container: RESOURCE_REF_SCHEMA,
        focus: {
          anyOf: [{ type: 'null' }, RESOURCE_REF_SCHEMA],
        },
      },
    },
    locale: { type: 'string', minLength: 2, maxLength: 35 },
    capabilities: {
      type: 'array',
      maxItems: 128,
      items: MANIFEST_REF_SCHEMA,
    },
    skills: {
      type: 'array',
      maxItems: 128,
      items: MANIFEST_REF_SCHEMA,
    },
  },
};

const STORY_CANVAS_READ_OUTPUT_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: [
    'project',
    'chapter',
    'chapterDirectory',
    'draft',
    'layout',
    'candidateAssets',
    'videoSelections',
  ],
  properties: {
    project: {
      ...OBJECT_SCHEMA,
      required: [
        'id',
        'workspaceId',
        'title',
        'format',
        'frameProfile',
        'defaultLocale',
        'coverAssetId',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        workspaceId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        format: { enum: ['interactive_film', 'text_adventure'] },
        frameProfile: { type: ['string', 'null'] },
        defaultLocale: { type: 'string', minLength: 2, maxLength: 35 },
        coverAssetId: {
          type: ['string', 'null'],
          format: 'uuid',
        },
      },
    },
    chapter: {
      ...OBJECT_SCHEMA,
      required: ['id', 'title', 'nodeIds', 'entryNodeId', 'isFirst'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        entryNodeId: { type: ['string', 'null'], minLength: 1 },
        isFirst: { type: 'boolean' },
      },
    },
    chapterDirectory: {
      type: 'array',
      items: {
        ...OBJECT_SCHEMA,
        required: ['id', 'title', 'entryNodeId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          entryNodeId: { type: ['string', 'null'], minLength: 1 },
        },
      },
    },
    draft: {
      ...OBJECT_SCHEMA,
      required: ['schemaVersion', 'revision', 'contentHash', 'content'],
      properties: {
        schemaVersion: { type: 'string', minLength: 1 },
        revision: { type: 'integer', minimum: 0 },
        contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        content: { type: 'object' },
      },
    },
    layout: {
      ...OBJECT_SCHEMA,
      required: [
        'schemaVersion',
        'revision',
        'nodePositions',
        'storyWorldNodePresent',
      ],
      properties: {
        schemaVersion: { type: 'string', minLength: 1 },
        revision: { type: 'integer', minimum: 0 },
        nodePositions: { type: 'object' },
        storyWorldNodePresent: { type: 'boolean' },
      },
    },
    candidateAssets: {
      type: 'array',
      items: {
        ...OBJECT_SCHEMA,
        required: [
          'mediaAssetId',
          'kind',
          'contentType',
          'sizeBytes',
          'width',
          'height',
          'durationSeconds',
          'status',
          'moderationStatus',
        ],
        properties: {
          mediaAssetId: { type: 'string', format: 'uuid' },
          kind: { type: 'string', minLength: 1 },
          contentType: { type: 'string', minLength: 1 },
          sizeBytes: {
            type: ['string', 'null'],
            pattern: '^[0-9]+$',
          },
          width: { type: ['integer', 'null'], minimum: 1 },
          height: { type: ['integer', 'null'], minimum: 1 },
          durationSeconds: { type: ['number', 'null'], minimum: 0 },
          status: { type: 'string', minLength: 1 },
          moderationStatus: { type: 'string', minLength: 1 },
        },
      },
    },
    videoSelections: {
      type: 'array',
      items: {
        ...OBJECT_SCHEMA,
        required: [
          'graphNodeId',
          'currentAssetId',
          'currentVariantId',
          'currentContentType',
          'currentDurationMs',
          'currentWidth',
          'currentHeight',
          'version',
        ],
        properties: {
          graphNodeId: { type: 'string', minLength: 1 },
          currentAssetId: { type: ['string', 'null'], format: 'uuid' },
          currentVariantId: { type: ['string', 'null'], format: 'uuid' },
          currentContentType: { type: ['string', 'null'] },
          currentDurationMs: { type: ['integer', 'null'], minimum: 0 },
          currentWidth: { type: ['integer', 'null'], minimum: 1 },
          currentHeight: { type: ['integer', 'null'], minimum: 1 },
          version: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
};

const STORY_CANVAS_PATCH_OUTPUT_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: [
    'projectId',
    'chapterId',
    'draftRevision',
    'layoutRevision',
    'draftChanged',
    'layoutChanged',
    'affectedNodeIds',
    'createdNodeIds',
  ],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    chapterId: { type: 'string', format: 'uuid' },
    draftRevision: { type: 'integer', minimum: 0 },
    layoutRevision: { type: 'integer', minimum: 0 },
    draftChanged: { type: 'boolean' },
    layoutChanged: { type: 'boolean' },
    affectedNodeIds: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    createdNodeIds: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
};

const CHILD_TASK_OUTPUT_SCHEMA: StudioAgentJsonObject = {
  ...OBJECT_SCHEMA,
  required: ['runId', 'status', 'summary'],
  properties: {
    runId: { type: 'string', format: 'uuid' },
    status: { const: 'succeeded' },
    summary: { type: ['string', 'null'], maxLength: 8_000 },
  },
};

const CAPABILITIES = [
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    capabilityId: 'studio.context.read',
    version: '1.0.0',
    name: 'Read studio context',
    description:
      'Read the authorized, revisioned product context for the current studio scope.',
    effect: 'read',
    risk: 'low',
    executionMode: 'action',
    reversible: true,
    streaming: false,
    idempotency: 'none',
    requiredScopes: ['studio.read'],
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        resources: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 128,
        },
      },
    },
    outputSchema: STUDIO_CONTEXT_OUTPUT_SCHEMA,
  },
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    capabilityId: 'studio.task.delegate',
    version: '1.0.0',
    name: 'Delegate studio task',
    description:
      'Run an independent, cancellable child task and report its progress to the parent turn.',
    // Delegation only creates an internal, cancellable orchestration boundary.
    // Every effect performed by that child is still authorized capability by
    // capability, so creating the child itself is a low-risk read operation.
    effect: 'read',
    risk: 'low',
    executionMode: 'child_run',
    reversible: true,
    streaming: true,
    idempotency: 'required',
    requiredScopes: ['studio.read'],
    inputSchema: {
      ...OBJECT_SCHEMA,
      required: ['taskKey', 'title', 'instruction'],
      properties: {
        taskKey: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 240 },
        instruction: { type: 'string', minLength: 1, maxLength: 20000 },
      },
    },
    outputSchema: CHILD_TASK_OUTPUT_SCHEMA,
  },
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    capabilityId: 'story.canvas.read',
    version: '1.0.0',
    name: 'Read story canvas',
    description:
      'Read the current chapter draft, canvas layout, assets, and revision identifiers.',
    effect: 'read',
    risk: 'low',
    executionMode: 'action',
    reversible: true,
    streaming: false,
    idempotency: 'none',
    requiredScopes: ['story.read'],
    inputSchema: OBJECT_SCHEMA,
    outputSchema: STORY_CANVAS_READ_OUTPUT_SCHEMA,
  },
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    capabilityId: 'story.canvas.apply_patch',
    version: '1.0.0',
    name: 'Apply story changes',
    description:
      'Apply a typed, reviewable patch to the current story draft using revision checks and a write fence.',
    effect: 'write',
    risk: 'high',
    executionMode: 'action',
    reversible: true,
    streaming: false,
    idempotency: 'required',
    requiredScopes: ['story.edit'],
    inputSchema: {
      ...OBJECT_SCHEMA,
      required: [
        'projectId',
        'chapterId',
        'baseDraftRevision',
        'baseLayoutRevision',
        'operations',
      ],
      properties: {
        projectId: { type: 'string', format: 'uuid' },
        chapterId: { type: 'string', format: 'uuid' },
        baseDraftRevision: { type: 'integer', minimum: 0 },
        baseLayoutRevision: { type: 'integer', minimum: 0 },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'object' },
        },
      },
    },
    outputSchema: STORY_CANVAS_PATCH_OUTPUT_SCHEMA,
  },
] as const satisfies readonly StudioAgentCapabilityManifest[];

const SKILLS = [
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    skillId: 'story.director',
    version: '1.0.0',
    name: 'Story director',
    description:
      'Analyze narrative intent, structure choices, and propose coherent story-canvas changes.',
    instructionSetId: 'story.director.v1',
    capabilities: [
      {
        capability: { id: 'story.canvas.read', version: '1.0.0' },
        required: true,
      },
      {
        capability: { id: 'studio.task.delegate', version: '1.0.0' },
        required: false,
      },
      {
        capability: {
          id: 'story.canvas.apply_patch',
          version: '1.0.0',
        },
        required: false,
      },
    ],
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
  },
] as const satisfies readonly StudioAgentSkillManifest[];

const SCENARIOS = [
  {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    scenarioId: 'story.studio.assistant',
    version: '1.0.0',
    surfaceId: 'story.studio',
    name: 'StoryOS',
    description:
      'A project-scoped story collaborator for analysis, planning, and reviewable canvas changes.',
    instructionSetId: 'story.studio.assistant.v1',
    capabilities: [
      {
        capability: { id: 'studio.context.read', version: '1.0.0' },
        required: true,
      },
      {
        capability: { id: 'story.canvas.read', version: '1.0.0' },
        required: true,
      },
      {
        capability: { id: 'studio.task.delegate', version: '1.0.0' },
        required: false,
      },
      {
        capability: {
          id: 'story.canvas.apply_patch',
          version: '1.0.0',
        },
        required: true,
      },
    ],
    skills: [
      {
        skill: { id: 'story.director', version: '1.0.0' },
        enabledByDefault: true,
      },
    ],
    defaultPermissionMode: 'smart',
    scopeSchema: {
      ...OBJECT_SCHEMA,
      required: ['workspaceId', 'container', 'focus'],
      properties: {
        workspaceId: { type: 'string', minLength: 1 },
        container: {
          type: 'object',
          additionalProperties: false,
          required: ['resourceType', 'resourceId', 'revision'],
          properties: {
            resourceType: { const: 'story.project' },
            resourceId: { type: 'string', format: 'uuid' },
            revision: { type: ['string', 'null'] },
          },
        },
        focus: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['resourceType', 'resourceId', 'revision'],
              properties: {
                resourceType: { const: 'story.chapter' },
                resourceId: { type: 'string', format: 'uuid' },
                revision: { type: ['string', 'null'] },
              },
            },
          ],
        },
      },
    },
  },
] as const satisfies readonly StudioAgentScenarioManifest[];

const INSTRUCTION_SETS = new Map<string, string>([
  [
    'story.studio.assistant.v1',
    [
      'You are StoryOS, a precise production collaborator inside Story Studio.',
      'Treat the registered capabilities as the only authoritative way to read or change product state.',
      'Never claim that a mutation happened until its tool result confirms success.',
      'Prefer concise, concrete progress updates while work is active, then give a direct outcome.',
      'Preserve the creator’s intent, current chapter scope, narrative continuity, and existing authored work.',
      'When a requested effect needs approval, explain the exact proposed change and wait for the approval result.',
      'Use the conversation locale for user-visible prose. Keep capability inputs structured and exact.',
    ].join('\n'),
  ],
  [
    'story.director.v1',
    [
      'Reason as an experienced interactive-story director.',
      'Check premise, character motivation, causal continuity, branch clarity, and playable consequences.',
      'Separate analysis from proposed canvas mutations. Make the smallest coherent change set that fulfills the request.',
    ].join('\n'),
  ],
]);

@Injectable()
export class StudioAgentRegistry {
  private readonly jsonSchema = createJsonSchemaValidator();
  private readonly capabilities = new Map(
    CAPABILITIES.map((manifest) => {
      const parsed = StudioAgentCapabilityManifestSchema.parse(manifest);
      return [
        manifestKey({
          id: parsed.capabilityId,
          version: parsed.version,
        }),
        parsed,
      ] as const;
    }),
  );
  private readonly capabilityInputValidators = new Map(
    [...this.capabilities].map(([key, manifest]) => [
      key,
      this.jsonSchema.compile(manifest.inputSchema),
    ]),
  );
  private readonly capabilityOutputValidators = new Map(
    [...this.capabilities].map(([key, manifest]) => [
      key,
      this.jsonSchema.compile(manifest.outputSchema),
    ]),
  );
  private readonly skills = new Map(
    SKILLS.map((manifest) => {
      const parsed = StudioAgentSkillManifestSchema.parse(manifest);
      return [
        manifestKey({ id: parsed.skillId, version: parsed.version }),
        parsed,
      ] as const;
    }),
  );
  private readonly scenarios = new Map(
    SCENARIOS.map((manifest) => {
      const parsed = StudioAgentScenarioManifestSchema.parse(manifest);
      return [
        manifestKey({ id: parsed.scenarioId, version: parsed.version }),
        parsed,
      ] as const;
    }),
  );

  capability(reference: StudioAgentManifestRef): StudioAgentCapabilityManifest {
    return requireManifest(
      this.capabilities,
      reference,
      'STUDIO_AGENT_CAPABILITY_NOT_FOUND',
    );
  }

  skill(reference: StudioAgentManifestRef): StudioAgentSkillManifest {
    return requireManifest(
      this.skills,
      reference,
      'STUDIO_AGENT_SKILL_NOT_FOUND',
    );
  }

  scenario(reference: StudioAgentManifestRef): StudioAgentScenarioManifest {
    return requireManifest(
      this.scenarios,
      reference,
      'STUDIO_AGENT_SCENARIO_NOT_FOUND',
    );
  }

  scenarioCapabilities(
    scenario: StudioAgentScenarioManifest,
  ): StudioAgentCapabilityManifest[] {
    return scenario.capabilities.map(({ capability }) =>
      this.capability(capability),
    );
  }

  scenarioSkills(
    scenario: StudioAgentScenarioManifest,
  ): StudioAgentSkillManifest[] {
    return scenario.skills.map(({ skill }) => this.skill(skill));
  }

  scenarioInstructions(scenario: StudioAgentScenarioManifest): string {
    const scenarioInstructions = requireInstructionSet(
      scenario.instructionSetId,
    );
    const skillInstructions = this.scenarioSkills(scenario).map((skill) =>
      requireInstructionSet(skill.instructionSetId),
    );
    return [scenarioInstructions, ...skillInstructions].join('\n\n');
  }

  validateCapabilityInput(
    reference: StudioAgentManifestRef,
    rawInput: unknown,
  ): StudioAgentJsonObject {
    const input = StudioAgentJsonObjectSchema.parse(rawInput);
    this.assertSchema(
      this.capabilityInputValidators,
      reference,
      input,
      'STUDIO_AGENT_CAPABILITY_INPUT_INVALID',
    );
    return input;
  }

  validateCapabilityOutput(
    reference: StudioAgentManifestRef,
    rawOutput: StudioAgentJsonValue,
  ): StudioAgentJsonValue {
    this.assertSchema(
      this.capabilityOutputValidators,
      reference,
      rawOutput,
      'STUDIO_AGENT_CAPABILITY_OUTPUT_INVALID',
    );
    return rawOutput;
  }

  private assertSchema(
    validators: ReadonlyMap<string, ValidateFunction>,
    reference: StudioAgentManifestRef,
    value: unknown,
    code: string,
  ): void {
    const key = manifestKey(reference);
    const validate = validators.get(key);
    if (!validate) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_CAPABILITY_NOT_FOUND',
        message: `Manifest ${key} is not registered.`,
      });
    }
    if (validate(value)) {
      return;
    }
    throw new BadRequestException({
      code,
      message: `Payload does not satisfy capability schema ${key}.`,
      details: validate.errors ?? [],
    });
  }
}

function manifestKey(reference: StudioAgentManifestRef): string {
  return `${reference.id}@${reference.version}`;
}

function requireManifest<T>(
  manifests: ReadonlyMap<string, T>,
  reference: StudioAgentManifestRef,
  code: string,
): T {
  const manifest = manifests.get(manifestKey(reference));
  if (manifest) return manifest;
  throw new NotFoundException({
    code,
    message: `Manifest ${manifestKey(reference)} is not registered.`,
  });
}

function createJsonSchemaValidator(): Ajv {
  const validator = new Ajv({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(validator);
  return validator;
}

function requireInstructionSet(instructionSetId: string): string {
  const instructions = INSTRUCTION_SETS.get(instructionSetId);
  if (instructions) {
    return instructions;
  }
  throw new NotFoundException({
    code: 'STUDIO_AGENT_INSTRUCTION_SET_NOT_FOUND',
    message: `Instruction set ${instructionSetId} is not registered.`,
  });
}
