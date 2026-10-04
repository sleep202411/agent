import {
  CreateCrewTaskCommentSchema,
  CreateCrewTaskSchema,
  ReviewCrewTaskSchema,
  UpdateCrewTaskSchema,
} from '../dto';

describe('crew task collaboration DTOs', () => {
  it('retains the recruitment position and multiple required skills on create and update', () => {
    const terms = {
      positionRole: 'editor',
      requiredSkills: ['Editing', 'Sound'],
    };
    expect(
      CreateCrewTaskSchema.parse({
        ...{
          description: 'Deliver work',
          taskKind: 'script',
          dueAt: '2099-10-03T00:00:00.000Z',
          rewardUsdMinor: 0,
        },
        title: 'Edit film',
        ...terms,
      }),
    ).toMatchObject(terms);
    expect(
      UpdateCrewTaskSchema.parse({ expectedVersion: 2, ...terms }),
    ).toMatchObject(terms);
    expect(
      UpdateCrewTaskSchema.parse({
        expectedVersion: 2,
        requiredSkills: [],
        positionRole: null,
      }),
    ).toMatchObject({ requiredSkills: [], positionRole: null });
  });
  it('allows an issue to be created unassigned and assigned later', () => {
    expect(
      CreateCrewTaskSchema.parse({
        ...{
          description: 'Deliver work',
          taskKind: 'script',
          dueAt: '2099-10-03T00:00:00.000Z',
          rewardUsdMinor: 0,
        },
        title: 'Paint the station background',
      }),
    ).toMatchObject({
      title: 'Paint the station background',
      assignees: [],
      blockedByTaskIds: [],
      customFieldValues: [],
      description: 'Deliver work',
      priority: 'normal',
    });
  });

  it('accepts hierarchy, blockers, and typed custom values together', () => {
    expect(
      CreateCrewTaskSchema.parse({
        ...{
          description: 'Deliver work',
          taskKind: 'script',
          dueAt: '2099-10-03T00:00:00.000Z',
          rewardUsdMinor: 0,
        },
        title: 'Polish the approved environment',
        parentId: '019fae00-00be-74c1-a94d-47209790ff7c',
        blockedByTaskIds: ['019fae04-e99a-7797-a23d-efaa3e4489f9'],
        customFieldValues: [
          {
            fieldId: '019fae05-e99a-7797-a23d-efaa3e4489f9',
            value: ['019fae06-e99a-7797-a23d-efaa3e4489f9'],
          },
        ],
      }),
    ).toMatchObject({
      parentId: '019fae00-00be-74c1-a94d-47209790ff7c',
      blockedByTaskIds: ['019fae04-e99a-7797-a23d-efaa3e4489f9'],
    });
  });

  it('requires optimistic concurrency and at least one task change', () => {
    expect(() => UpdateCrewTaskSchema.parse({ expectedVersion: 3 })).toThrow(
      'At least one task field must be changed',
    );
    expect(() =>
      UpdateCrewTaskSchema.parse({ title: 'Missing version' }),
    ).toThrow();
    expect(
      UpdateCrewTaskSchema.parse({
        expectedVersion: 3,
        workflowStateId: '019fae00-00be-74c1-a94d-47209790ff7c',
        assignees: [],
      }),
    ).toMatchObject({ expectedVersion: 3, assignees: [] });
  });

  it('validates the revision agreement and requires actionable revision notes', () => {
    expect(
      CreateCrewTaskSchema.parse({
        ...{
          description: 'Deliver work',
          taskKind: 'script',
          dueAt: '2099-10-03T00:00:00.000Z',
          rewardUsdMinor: 0,
        },
        title: 'Paint the station background',
        revisionLimit: 2,
      }),
    ).toMatchObject({ revisionLimit: 2 });
    expect(() =>
      CreateCrewTaskSchema.parse({
        ...{
          description: 'Deliver work',
          taskKind: 'script',
          dueAt: '2099-10-03T00:00:00.000Z',
          rewardUsdMinor: 0,
        },
        title: 'Paint the station background',
        revisionLimit: 101,
      }),
    ).toThrow();
    expect(() =>
      ReviewCrewTaskSchema.parse({
        expectedSubmissionId: '01910d50-4c88-7c78-92d4-16892c06a010',
        decision: 'request_revision',
        note: '',
      }),
    ).toThrow('Revision instructions are required');
    expect(
      ReviewCrewTaskSchema.parse({
        expectedSubmissionId: '01910d50-4c88-7c78-92d4-16892c06a010',
        decision: 'approve',
        note: '',
      }),
    ).toMatchObject({ decision: 'approve' });
  });

  it('accepts text or attachments but rejects an empty comment', () => {
    expect(() =>
      CreateCrewTaskCommentSchema.parse({
        body: '',
        clientKey: 'retry-key',
      }),
    ).toThrow('A comment needs text or at least one attachment');
    expect(
      CreateCrewTaskCommentSchema.parse({
        body: '',
        clientKey: 'retry-key',
        attachments: [
          {
            source: 'upload',
            mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a010',
            name: 'SC010.png',
          },
        ],
      }),
    ).toMatchObject({ body: '', clientKey: 'retry-key' });
  });

  it('rejects duplicate attachments before any storage claim', () => {
    expect(() =>
      CreateCrewTaskCommentSchema.parse({
        body: 'Review this',
        clientKey: 'retry-key',
        attachments: [
          {
            source: 'asset',
            assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
          },
          {
            source: 'asset',
            assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
          },
        ],
      }),
    ).toThrow('The same attachment cannot be added twice');
  });
});

it('requires the reviewed submission identity', () => {
  expect(ReviewCrewTaskSchema.safeParse({ decision: 'approve' }).success).toBe(
    false,
  );
  expect(
    ReviewCrewTaskSchema.safeParse({
      decision: 'approve',
      expectedSubmissionId: 'invalid',
    }).success,
  ).toBe(false);
});

it.each(['description', 'taskKind', 'dueAt', 'rewardUsdMinor'])(
  'requires %s on task creation',
  (field) => {
    const input: Record<string, unknown> = {
      title: 'Task',
      description: 'Brief',
      taskKind: 'script',
      dueAt: '2099-10-03T00:00:00.000Z',
      rewardUsdMinor: 0,
    };
    delete input[field];
    const parsed = CreateCrewTaskSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.some((issue) => issue.path[0] === field)).toBe(
        true,
      );
  },
);
