import {
  BatchUpdateCrewTasksSchema,
  CreateCrewTaskCycleSchema,
  CreateCrewTaskFieldSchema,
  CreateCrewTaskViewSchema,
  CreateCrewTaskWorkflowStateSchema,
  ReorderCrewTaskSchema,
  ReorderCrewTaskWorkflowStatesSchema,
  UpdateCrewTaskCycleSchema,
  UpdateCrewTaskLabelSchema,
  UpdateCrewTaskWorkflowStateSchema,
  UpdateCrewTaskViewSchema,
} from './project-dto';

describe('crew task project DTOs', () => {
  it('accepts a persisted multi-view configuration', () => {
    const parsed = CreateCrewTaskViewSchema.parse({
      name: 'Scene delivery',
      layout: 'board',
      scope: 'active',
      groupBy: 'status',
      filters: {
        workflowStateIds: [
          '019fae00-00be-74c1-a94d-47209790ff7c',
          '019fae00-00be-74c1-a94d-47209790ff7d',
        ],
        priorities: ['urgent', 'high'],
        unassigned: true,
      },
      sorts: [{ field: 'priority', direction: 'asc' }],
      visibleFields: ['number', 'assignees', 'cycle', 'dueAt'],
    });

    expect(parsed.layout).toBe('board');
    expect(parsed.filters.workflowStateIds).toHaveLength(2);
  });

  it('rejects unknown filters instead of silently changing view semantics', () => {
    const result = CreateCrewTaskViewSchema.safeParse({
      name: 'Broken view',
      layout: 'table',
      filters: { department: 'art' },
    });

    expect(result.success).toBe(false);
  });

  it('requires optimistic concurrency for shared view edits', () => {
    expect(
      UpdateCrewTaskViewSchema.safeParse({ layout: 'calendar' }).success,
    ).toBe(false);
  });

  it('rejects an inverted production cycle', () => {
    const result = CreateCrewTaskCycleSchema.safeParse({
      name: 'Episode 1',
      goal: '',
      startAt: '2026-08-10T00:00:00.000Z',
      endAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('requires optimistic concurrency for production cycle edits', () => {
    expect(
      UpdateCrewTaskCycleSchema.safeParse({ status: 'active' }).success,
    ).toBe(false);
    expect(
      UpdateCrewTaskCycleSchema.safeParse({
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        status: 'active',
      }).success,
    ).toBe(true);
  });

  it('rejects ambiguous reorder anchors', () => {
    const id = '019fae00-00be-74c1-a94d-47209790ff7c';
    const result = ReorderCrewTaskSchema.safeParse({
      expectedVersion: 2,
      beforeTaskId: id,
      beforeTaskVersion: 1,
      afterTaskId: id,
      afterTaskVersion: 1,
    });

    expect(result.success).toBe(false);
  });

  it('requires a version for every reorder anchor', () => {
    const result = ReorderCrewTaskSchema.safeParse({
      expectedVersion: 2,
      beforeTaskId: '019fae00-00be-74c1-a94d-47209790ff7c',
    });

    expect(result.success).toBe(false);
  });

  it('requires a real batch mutation', () => {
    const result = BatchUpdateCrewTasksSchema.safeParse({
      taskIds: ['019fae04-e99a-7797-a23d-efaa3e4489f9'],
    });

    expect(result.success).toBe(false);
  });

  it('accepts stable options for a typed select field', () => {
    const field = CreateCrewTaskFieldSchema.parse({
      name: 'Department',
      type: 'single_select',
      options: [
        {
          id: '019fae00-00be-74c1-a94d-47209790ff7c',
          label: 'Storyboard',
          color: '#e12b32',
        },
      ],
      required: true,
    });

    expect(field.options[0]?.label).toBe('Storyboard');
    expect(field.required).toBe(true);
  });

  it('rejects options on a scalar custom field', () => {
    expect(
      CreateCrewTaskFieldSchema.safeParse({
        name: 'Shot count',
        type: 'number',
        options: [
          {
            id: '019fae00-00be-74c1-a94d-47209790ff7c',
            label: 'Ten',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a custom workflow column with stable lifecycle behavior', () => {
    const parsed = CreateCrewTaskWorkflowStateSchema.parse({
      name: 'Lighting pass',
      color: '#63A8FF',
      semantic: 'in_progress',
      afterStateId: '019fae00-00be-74c1-a94d-47209790ff7c',
    });

    expect(parsed).toMatchObject({
      name: 'Lighting pass',
      semantic: 'in_progress',
    });
  });

  it('requires optimistic concurrency for workflow edits and every reordered column', () => {
    expect(
      UpdateCrewTaskWorkflowStateSchema.safeParse({ name: 'Review' }).success,
    ).toBe(false);
    expect(
      ReorderCrewTaskWorkflowStatesSchema.safeParse({
        states: [
          {
            id: '019fae00-00be-74c1-a94d-47209790ff7c',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires optimistic concurrency and a real change for label edits', () => {
    expect(
      UpdateCrewTaskLabelSchema.safeParse({ name: 'Environment' }).success,
    ).toBe(false);
    expect(
      UpdateCrewTaskLabelSchema.safeParse({
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      UpdateCrewTaskLabelSchema.safeParse({
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        color: '#63A8FF',
      }).success,
    ).toBe(true);
  });
});
