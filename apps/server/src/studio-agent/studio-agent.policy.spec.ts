import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentCapabilityManifest,
  type StudioAgentPermissionPolicy,
} from '@repo/shared/studio-agent';
import { StudioAgentPolicyEngine } from './studio-agent.policy';

const policy: StudioAgentPermissionPolicy = {
  schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
  policyId: '019f0000-0000-7000-8000-000000000001',
  revision: 1,
  mode: 'smart',
  rules: [],
  createdAt: '2026-07-24T00:00:00.000Z',
};

const capability: StudioAgentCapabilityManifest = {
  schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
  capabilityId: 'story.canvas.apply_patch',
  version: '1.0.0',
  name: 'Apply story patch',
  description: 'Apply a typed story patch.',
  effect: 'write',
  risk: 'high',
  executionMode: 'action',
  reversible: true,
  streaming: false,
  idempotency: 'required',
  requiredScopes: ['story.edit'],
  inputSchema: {},
  outputSchema: {},
};

describe('StudioAgentPolicyEngine', () => {
  const engine = new StudioAgentPolicyEngine();

  it('denies before user policy when domain scope is unavailable', () => {
    expect(
      engine.evaluate(policy, capability, {
        scenarioId: 'story.studio.assistant',
        resourceType: 'story.project',
        grantedScopes: new Set(['story.read']),
      }),
    ).toMatchObject({ decision: 'deny', source: 'platform' });
  });

  it('auto-approves high-impact non-delete writes in smart mode', () => {
    expect(
      engine.evaluate(policy, capability, {
        scenarioId: 'story.studio.assistant',
        resourceType: 'story.project',
        grantedScopes: new Set(['story.edit']),
      }),
    ).toMatchObject({ decision: 'allow', source: 'mode' });
  });

  it('still asks before deletions in smart mode', () => {
    expect(
      engine.evaluate(
        policy,
        { ...capability, effect: 'delete' },
        {
          scenarioId: 'story.studio.assistant',
          resourceType: 'story.project',
          grantedScopes: new Set(['story.edit']),
        },
      ),
    ).toMatchObject({ decision: 'ask', source: 'mode' });
  });

  it('applies the highest-priority matching custom rule deterministically', () => {
    const custom: StudioAgentPermissionPolicy = {
      ...policy,
      mode: 'custom',
      rules: [
        {
          ruleId: '019f0000-0000-7000-8000-000000000002',
          priority: 10,
          selector: {
            scenarioId: null,
            capabilityId: capability.capabilityId,
            capabilityVersion: capability.version,
            resourceType: null,
            effect: null,
            risk: null,
          },
          decision: 'allow',
        },
        {
          ruleId: '019f0000-0000-7000-8000-000000000003',
          priority: 1,
          selector: {
            scenarioId: null,
            capabilityId: capability.capabilityId,
            capabilityVersion: capability.version,
            resourceType: null,
            effect: null,
            risk: null,
          },
          decision: 'deny',
        },
      ],
    };

    expect(
      engine.evaluate(custom, capability, {
        scenarioId: 'story.studio.assistant',
        resourceType: 'story.project',
        grantedScopes: new Set(['story.edit']),
      }),
    ).toMatchObject({
      decision: 'allow',
      source: 'rule',
      ruleId: custom.rules[0].ruleId,
    });
  });
});
