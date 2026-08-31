import { MODEL_PROFILE_ID_PATTERN } from '@repo/shared';

import {
  AgentOsApprovalBodySchema,
  AgentOsModelPreferencesBodySchema,
  AgentOsStartRunBodySchema,
  AgentOsUserInputBodySchema,
} from './agent-os-gateway.dto';

describe('AgentOsModelPreferencesBodySchema', () => {
  const valid = {
    expectedVersion: 0,
    chatModelProfileId: 'qwen3.7-plus',
    imageModelId: 'image-model',
    videoModelId: null,
  };

  it('accepts explicit models and automatic nulls', () => {
    expect(AgentOsModelPreferencesBodySchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      AgentOsModelPreferencesBodySchema.safeParse({
        expectedVersion: 2,
        chatModelProfileId: null,
        imageModelId: null,
        videoModelId: null,
      }).success,
    ).toBe(true);
  });

  it('rejects omitted fields, negative versions, and unknown keys', () => {
    expect(
      AgentOsModelPreferencesBodySchema.safeParse({
        ...valid,
        imageModelId: undefined,
      }).success,
    ).toBe(false);
    expect(
      AgentOsModelPreferencesBodySchema.safeParse({
        ...valid,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      AgentOsModelPreferencesBodySchema.safeParse({ ...valid, extra: true })
        .success,
    ).toBe(false);
  });
});

describe('AgentOsApprovalBodySchema', () => {
  const valid = {
    approvalId: '11111111-1111-4111-8111-111111111111',
    responseId: '22222222-2222-4222-8222-222222222222',
    decision: 'approve' as const,
    responseText: 'Approved',
    locale: 'en-US' as const,
    conversationId: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    modelProfileId: 'qwen-plus',
  };

  it('requires stable approval and response identities', () => {
    expect(AgentOsApprovalBodySchema.safeParse(valid).success).toBe(true);
    expect(
      AgentOsApprovalBodySchema.safeParse({ ...valid, responseId: undefined })
        .success,
    ).toBe(false);
    expect(
      AgentOsApprovalBodySchema.safeParse({ ...valid, approvalId: 'not-uuid' })
        .success,
    ).toBe(false);
  });

  it('rejects unsupported edit-and-approve and unbounded display copy', () => {
    expect(
      AgentOsApprovalBodySchema.safeParse({
        ...valid,
        decision: 'edit_and_approve',
      }).success,
    ).toBe(false);
    expect(
      AgentOsApprovalBodySchema.safeParse({
        ...valid,
        responseText: 'x'.repeat(301),
      }).success,
    ).toBe(false);
  });
});

const validBody = (modelProfileId: string) => ({
  projectId: '00000000-0000-4000-8000-000000000000',
  conversationId: '11111111-1111-4111-8111-111111111111',
  clientSubmissionId: '22222222-2222-4222-8222-222222222222',
  turnId: '33333333-3333-4333-8333-333333333333',
  messageId: '44444444-4444-4444-8444-444444444444',
  message: 'hi',
  modelProfileId,
  permissionMode: 'ask' as const,
  workbenchMode: 'storyboard',
});

describe('AgentOsUserInputBodySchema', () => {
  const valid = {
    requestId: '11111111-1111-4111-8111-111111111111',
    responseId: '22222222-2222-4222-8222-222222222222',
    answers: { aspect_ratio: 'landscape_16_9' },
    conversationId: '22222222-2222-4222-8222-222222222222',
    projectId: '33333333-3333-4333-8333-333333333333',
    modelProfileId: 'qwen-plus',
  };

  it('accepts bounded structured answers', () => {
    expect(AgentOsUserInputBodySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty or unbounded answer map', () => {
    expect(
      AgentOsUserInputBodySchema.safeParse({
        ...valid,
        answers: { aspect_ratio: '' },
      }).success,
    ).toBe(false);
  });
});

describe('AgentOsStartRunBodySchema — model profile id', () => {
  it('requires stable client identities and enforces the 20k message boundary', () => {
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        clientSubmissionId: undefined,
      }).success,
    ).toBe(false);
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        message: 'x'.repeat(20_000),
      }).success,
    ).toBe(true);
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        message: 'x'.repeat(20_001),
      }).success,
    ).toBe(false);
  });

  it('accepts attachment-only input without fabricating user transcript copy', () => {
    const attachmentOnly = {
      ...validBody('qwen-plus'),
      message: '',
      attachmentIds: ['55555555-5555-4555-8555-555555555555'],
    };
    expect(AgentOsStartRunBodySchema.safeParse(attachmentOnly).success).toBe(
      true,
    );
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...attachmentOnly,
        attachmentIds: undefined,
      }).success,
    ).toBe(false);
  });

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

  it('accepts the active Story chapter as workbench context', () => {
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        workbenchMode: 'story',
        workbenchContext: {
          chapterId: '11111111-1111-4111-8111-111111111111',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts one Platform section and rejects ambiguous scoped context', () => {
    const sectionId = '22222222-2222-4222-8222-222222222222';
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        workbenchContext: { sectionId },
      }).success,
    ).toBe(true);
    expect(
      AgentOsStartRunBodySchema.safeParse({
        ...validBody('qwen-plus'),
        workbenchContext: {
          sectionId,
          chapterId: '11111111-1111-4111-8111-111111111111',
        },
      }).success,
    ).toBe(false);
  });
});
