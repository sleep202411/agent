import { MODEL_PROFILE_ID_PATTERN } from '@repo/shared';

import { AgentOsStartRunBodySchema } from './agent-os-gateway.dto';

const validBody = (modelProfileId: string) => ({
  projectId: '00000000-0000-4000-8000-000000000000',
  message: 'hi',
  modelProfileId,
  permissionMode: 'ask' as const,
  surface: 'storyboard' as const,
});

describe('AgentOsStartRunBodySchema — model profile id', () => {
  // Shipped ids carry a dot (qwen3.7-plus, glm-5.2). This schema used to hold
  // its own copy of the pattern that forbade one, so every run died here with a
  // raw ZodError and the worker was never reached. The gateway check is a cheap
  // syntactic guard in front of the worker's real profile list — a guard that
  // is narrower than what it guards is worse than no guard at all.
  it('accepts a dotted id', () => {
    expect(
      AgentOsStartRunBodySchema.safeParse(validBody('qwen3.7-plus')).success,
    ).toBe(true);
    expect(
      AgentOsStartRunBodySchema.safeParse(validBody('glm-5.2')).success,
    ).toBe(true);
  });

  it('still rejects ids the wire cannot carry', () => {
    for (const bad of [
      'Qwen-Plus',
      '3-leading-digit',
      'has space',
      'has/slash',
      '',
    ]) {
      expect(AgentOsStartRunBodySchema.safeParse(validBody(bad)).success).toBe(
        false,
      );
    }
  });

  // Pins the schema to the ONE definition rather than to a copy of its current
  // behaviour: widen the shared pattern and this keeps passing, retype it here
  // and it fails.
  it('derives its rule from the shared pattern', () => {
    const sample = 'qwen3.7-plus';
    expect(MODEL_PROFILE_ID_PATTERN.test(sample)).toBe(true);
    expect(AgentOsStartRunBodySchema.safeParse(validBody(sample)).success).toBe(
      true,
    );
  });
});
