import {
  CreateCrewTaskCommentSchema,
  CreateCrewTaskSchema,
  ReviewCrewTaskSchema,
  UpdateCrewTaskSchema,
} from '../dto';

describe('crew task collaboration DTOs', () => {
  it('allows an issue to be created unassigned and assigned later', () => {
    expect(
      CreateCrewTaskSchema.parse({
        title: 'Paint the station background',
      }),
    ).toMatchObject({
      title: 'Paint the station background',
      assignees: [],
      blockedByTaskIds: [],
      customFieldValues: [],
      description: '',
      priority: 'normal',
    });
  });

  it('accepts hierarchy, blockers, and typed custom values together', () => {
    expect(
      CreateCrewTaskSchema.parse({
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
        title: 'Paint the station background',
        revisionLimit: 2,
      }),
    ).toMatchObject({ revisionLimit: 2 });
    expect(() =>
      CreateCrewTaskSchema.parse({
        title: 'Paint the station background',
        revisionLimit: 101,
      }),
    ).toThrow();
    expect(() =>
      ReviewCrewTaskSchema.parse({
        decision: 'request_revision',
        note: '',
      }),
    ).toThrow('Revision instructions are required');
    expect(
      ReviewCrewTaskSchema.parse({
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
