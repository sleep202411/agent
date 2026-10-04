import { z } from 'zod';
import { CrewTaskKind } from '@prisma/client';

export const CrewTaskViewLayoutSchema = z.enum(['list', 'board']);
export const CrewTaskCompletedModeSchema = z.enum(['all', 'recent', 'hidden']);
export const CrewTaskViewGroupSchema = z.enum([
  'none',
  'status',
  'priority',
  'assignee',
  'cycle',
]);
export const CrewTaskViewFieldSchema = z.union([
  z.enum([
    'number',
    'status',
    'priority',
    'assignees',
    'cycle',
    'labels',
    'estimate',
    'points',
    'startAt',
    'dueAt',
    'updatedAt',
    'parent',
    'subtasks',
    'blockedBy',
  ]),
  z
    .string()
    .regex(
      /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Invalid custom task field column',
    ),
]);
export const CrewTaskViewSortFieldSchema = z.enum([
  'rank',
  'number',
  'title',
  'status',
  'priority',
  'startAt',
  'dueAt',
  'updatedAt',
]);

export const CrewTaskViewFiltersSchema = z
  .object({
    workflowStateIds: z.array(z.string().uuid()).max(24).optional(),
    priorities: z
      .array(z.enum(['low', 'normal', 'high', 'urgent']))
      .max(4)
      .optional(),
    assigneeUserIds: z
      .array(z.string().trim().min(1).max(64))
      .max(50)
      .optional(),
    cycleIds: z.array(z.string().uuid()).max(50).optional(),
    labelIds: z.array(z.string().uuid()).max(50).optional(),
    unassigned: z.boolean().optional(),
    overdue: z.boolean().optional(),
  })
  .strict();

export const CrewTaskViewSortSchema = z
  .object({
    field: CrewTaskViewSortFieldSchema,
    direction: z.enum(['asc', 'desc']),
  })
  .strict();

export const CreateCrewTaskViewSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    layout: CrewTaskViewLayoutSchema,
    groupBy: CrewTaskViewGroupSchema.default('none'),
    filters: CrewTaskViewFiltersSchema.default({}),
    sorts: z.array(CrewTaskViewSortSchema).max(3).default([]),
    visibleFields: z.array(CrewTaskViewFieldSchema).max(30).default([]),
    completedMode: CrewTaskCompletedModeSchema.default('all'),
    showSubIssues: z.boolean().default(true),
    showEmptyGroups: z.boolean().default(false),
  })
  .strict();
export type CreateCrewTaskViewInput = z.infer<typeof CreateCrewTaskViewSchema>;

export const UpdateCrewTaskViewSchema = CreateCrewTaskViewSchema.partial()
  .extend({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    { message: 'At least one view setting must be changed' },
  );
export type UpdateCrewTaskViewInput = z.infer<typeof UpdateCrewTaskViewSchema>;

/**
 * One persisted Projects view, evaluated by the server. The cursor is opaque
 * to clients (currently the last stable task id); callers must discard it
 * whenever the view, search, or quick-priority filter changes.
 */
export const ListCrewTasksQuerySchema = z
  .object({
    viewId: z.union([z.string().uuid(), z.literal('production')]),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    query: z.string().trim().max(180).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  })
  .strict();
export type ListCrewTasksQuery = z.infer<typeof ListCrewTasksQuerySchema>;

/**
 * Lightweight relationship/card picker search. It deliberately has its own
 * bounded contract instead of loading the complete issue collection.
 */
export const ListCrewTaskOptionsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    query: z.string().trim().max(180).optional(),
    excludeTaskId: z.string().uuid().optional(),
    recruitmentOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    activeOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
  })
  .strict();
export type ListCrewTaskOptionsQuery = z.infer<
  typeof ListCrewTaskOptionsQuerySchema
>;

export const CreateCrewTaskCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().trim().max(2_000).default(''),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((input) => new Date(input.endAt) > new Date(input.startAt), {
    path: ['endAt'],
    message: 'Cycle end must be after its start',
  });
export type CreateCrewTaskCycleInput = z.infer<
  typeof CreateCrewTaskCycleSchema
>;

export const UpdateCrewTaskCycleSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(100).optional(),
    goal: z.string().trim().max(2_000).optional(),
    status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    {
      message: 'At least one cycle field must be changed',
    },
  );
export type UpdateCrewTaskCycleInput = z.infer<
  typeof UpdateCrewTaskCycleSchema
>;

export const CreateCrewTaskLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/),
    description: z.string().trim().max(240).default(''),
  })
  .strict();
export type CreateCrewTaskLabelInput = z.infer<
  typeof CreateCrewTaskLabelSchema
>;

export const UpdateCrewTaskLabelSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(64).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    description: z.string().trim().max(240).optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    { message: 'At least one label setting must be changed' },
  );
export type UpdateCrewTaskLabelInput = z.infer<
  typeof UpdateCrewTaskLabelSchema
>;

export const CrewTaskFieldTypeSchema = z.enum([
  'text',
  'number',
  'single_select',
  'multi_select',
  'date',
  'checkbox',
  'user',
]);

const CrewTaskFieldOptionSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(80),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export const CreateCrewTaskFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).default(''),
    type: CrewTaskFieldTypeSchema,
    options: z.array(CrewTaskFieldOptionSchema).max(50).default([]),
    required: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    const supportsOptions =
      input.type === 'single_select' || input.type === 'multi_select';
    if (!supportsOptions && input.options.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Only select fields can define options',
      });
    }
    if (
      new Set(input.options.map((option) => option.id)).size !==
      input.options.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Option ids must be unique',
      });
    }
  });
export type CreateCrewTaskFieldInput = z.infer<
  typeof CreateCrewTaskFieldSchema
>;

export const UpdateCrewTaskFieldSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(240).optional(),
    options: z.array(CrewTaskFieldOptionSchema).max(50).optional(),
    required: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    { message: 'At least one custom field setting must be changed' },
  );
export type UpdateCrewTaskFieldInput = z.infer<
  typeof UpdateCrewTaskFieldSchema
>;

export const CrewTaskWorkflowSemanticSchema = z.enum([
  'open',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'cancelled',
]);

export const CreateCrewTaskWorkflowStateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/),
    semantic: CrewTaskWorkflowSemanticSchema.default('in_progress'),
    afterStateId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type CreateCrewTaskWorkflowStateInput = z.infer<
  typeof CreateCrewTaskWorkflowStateSchema
>;

export const UpdateCrewTaskWorkflowStateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    archived: z.boolean().optional(),
    replacementStateId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.color !== undefined ||
      input.archived !== undefined,
    { message: 'At least one workflow state setting must be changed' },
  );
export type UpdateCrewTaskWorkflowStateInput = z.infer<
  typeof UpdateCrewTaskWorkflowStateSchema
>;

export const ReorderCrewTaskWorkflowStatesSchema = z
  .object({
    states: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.states.map((state) => state.id)).size !==
      input.states.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['states'],
        message: 'Workflow state ids must be unique',
      });
    }
  });
export type ReorderCrewTaskWorkflowStatesInput = z.infer<
  typeof ReorderCrewTaskWorkflowStatesSchema
>;

export const ReorderCrewTaskSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    beforeTaskId: z.string().uuid().nullable().default(null),
    beforeTaskVersion: z.number().int().positive().nullable().default(null),
    afterTaskId: z.string().uuid().nullable().default(null),
    afterTaskVersion: z.number().int().positive().nullable().default(null),
    workflowStateId: z.string().uuid().optional(),
    cycleId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.beforeTaskId !== null &&
      input.afterTaskId !== null &&
      input.beforeTaskId === input.afterTaskId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reorder anchors must be different tasks',
      });
    }
    if ((input.beforeTaskId === null) !== (input.beforeTaskVersion === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beforeTaskVersion'],
        message: 'The before anchor id and version must be supplied together',
      });
    }
    if ((input.afterTaskId === null) !== (input.afterTaskVersion === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['afterTaskVersion'],
        message: 'The after anchor id and version must be supplied together',
      });
    }
  });
export type ReorderCrewTaskInput = z.infer<typeof ReorderCrewTaskSchema>;

export const BatchUpdateCrewTasksSchema = z
  .object({
    taskIds: z.array(z.string().uuid()).min(1).max(100),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    cycleId: z.string().uuid().nullable().optional(),
    addLabelIds: z.array(z.string().uuid()).max(20).optional(),
    removeLabelIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.priority !== undefined ||
      input.cycleId !== undefined ||
      Boolean(input.addLabelIds?.length) ||
      Boolean(input.removeLabelIds?.length),
    { message: 'At least one batch change is required' },
  );
export type BatchUpdateCrewTasksInput = z.infer<
  typeof BatchUpdateCrewTasksSchema
>;

export const CrewTaskCenterQuerySchema = z.object({
  hasContract: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  scope: z.enum(['all', 'mine', 'managed']).default('all'),
  status: z
    .enum([
      'active',
      'all',
      'submitted',
      'revision_requested',
      'overdue',
      'approved',
    ])
    .default('active'),
  crewId: z.string().uuid().optional(),
  taskKind: z.nativeEnum(CrewTaskKind).optional(),
  query: z.string().trim().max(180).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CrewTaskCenterQuery = z.infer<typeof CrewTaskCenterQuerySchema>;
