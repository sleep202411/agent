import { z } from 'zod';

import {
  ALL_CURRENCIES,
  CREW_GENRES,
  CREW_STYLES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  WORK_MODES,
  isPresetPosition,
} from '@repo/shared/crew';

import type { AgentDomainToolId } from './agent-domain.dto';
import {
  StorySourceAnalysisQueryArgumentsSchema,
  StorySourceMaterialQueryArgumentsSchema,
} from './story-source-material-index';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cursorSchema = identifierSchema.optional();
const pageSizeSchema = z.number().int().min(1).max(100).default(50);
const positionTypeSchema = z
  .string()
  .trim()
  .refine(isPresetPosition, 'positionType must be a supported Crew position');
const currencySchema = z.enum(ALL_CURRENCIES);

const salarySchema = z
  .object({
    period: z.enum(SALARY_PERIODS).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    min: z.number().min(0).max(100_000_000).nullable().optional(),
    max: z.number().min(0).max(100_000_000).nullable().optional(),
    negotiable: z.boolean().optional(),
  })
  .strict()
  .superRefine((salary, context) => {
    if (salary.min != null && salary.max != null && salary.max < salary.min) {
      context.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'salary.max must be greater than or equal to salary.min',
      });
    }
    if ((salary.min != null || salary.max != null) && salary.currency == null) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'salary.currency is required when an amount is set',
      });
    }
  });

const positionFields = {
  positionType: positionTypeSchema,
  description: z.string().trim().min(1).max(1_000),
  targetCount: z.number().int().min(1).max(99),
  workMode: z.enum(WORK_MODES),
  location: z.string().trim().min(1).max(128).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  experienceLevel: z.enum(EXPERIENCE_LEVELS),
  requiredSkills: z.array(z.string().trim().min(1).max(64)).max(20),
  salary: salarySchema.optional(),
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
  revenueSharePercent: z
    .number()
    .min(0.5)
    .max(50)
    .multipleOf(0.5)
    .nullable()
    .optional(),
  closeDate: dateSchema.nullable().optional(),
} as const;

const createPositionSchema = z
  .object(positionFields)
  .strict()
  .refine(
    (position) => position.workMode === 'remote' || position.location != null,
    {
      path: ['location'],
      message: 'location is required for hybrid and onsite positions',
    },
  );

const positionPatchSchema = z
  .object({
    description: positionFields.description.optional(),
    targetCount: positionFields.targetCount.optional(),
    workMode: positionFields.workMode.optional(),
    location: positionFields.location,
    employmentType: positionFields.employmentType.optional(),
    experienceLevel: positionFields.experienceLevel.optional(),
    requiredSkills: positionFields.requiredSkills.optional(),
    salary: salarySchema.optional(),
    durationMonths: positionFields.durationMonths,
    revenueSharePercent: positionFields.revenueSharePercent,
    closeDate: positionFields.closeDate,
    status: z.enum(['open', 'frozen']).optional(),
  })
  .strict()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'position.update must change at least one field',
  );

export const StoryReadArgumentsSchema = z
  .object({
    schemaVersion: z.literal('story-read/v2'),
    chapterId: z.uuid().optional(),
    nodeCursor: cursorSchema,
    nodeLimit: pageSizeSchema,
    includeStoryBible: z.boolean().default(true),
    includeAssets: z.boolean().default(false),
  })
  .strict();

const modelStoryOperationSchema = z
  .object({
    kind: z.enum([
      'story_bible.update_overview',
      'story_bible.put_character',
      'story_bible.remove_character',
      'story_bible.put_ending',
      'story_bible.remove_ending',
      'story_graph.set_entry_node',
      'story_graph.put_node',
      'story_graph.remove_node',
      'story_graph.reorder_nodes',
      'production.replace_notes',
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const StoryApplyArgumentsSchema = z
  .object({
    schemaVersion: z.literal('story-apply/v1'),
    changeSet: z
      .object({
        schemaVersion: z.literal('story-change-set/v2'),
        chapterId: z.uuid(),
        baseDraftRevision: z.number().int().nonnegative(),
        baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
        baseLayoutRevision: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().min(1).max(4_000),
        operations: z.array(modelStoryOperationSchema).min(1).max(100),
      })
      .strict(),
  })
  .strict();

export const CrewReadArgumentsSchema = z
  .object({
    schemaVersion: z.literal('crew-read/v2'),
    section: z
      .enum([
        'overview',
        'positions',
        'applications',
        'members',
        'episodes',
        'assignments',
        'activity',
      ])
      .default('overview'),
    cursor: cursorSchema,
    limit: pageSizeSchema,
    episodeId: identifierSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.section === 'assignments' || input.section === 'activity') &&
      !input.episodeId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: `episodeId is required for ${input.section}`,
      });
    }
  });

const commandEnvelopeShape = {
  baseRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(2_000),
} as const;

export const CrewManagementArgumentsSchema = z
  .object({
    schemaVersion: z.literal('crew-management-command/v2'),
    ...commandEnvelopeShape,
    command: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('crew.profile.update'),
          patch: z
            .object({
              name: z.string().trim().min(1).max(128).optional(),
              description: z.string().trim().min(1).max(2_000).optional(),
              tagline: z.string().trim().max(140).nullable().optional(),
              genres: z.array(z.enum(CREW_GENRES)).max(5).optional(),
              styles: z.array(z.enum(CREW_STYLES)).max(5).optional(),
            })
            .strict()
            .refine(
              (patch) =>
                Object.values(patch).some((value) => value !== undefined),
              'crew.profile.update must change at least one field',
            ),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.listing.update'),
          listingStatus: z.enum(['unlisted', 'listed']),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.owner.transfer'),
          toUserId: identifierSchema,
          removeOldOwner: z.boolean().default(false),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.application.approve'),
          applicationId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.application.reject'),
          applicationId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.member.remove'),
          memberId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.member.finance.set'),
          memberId: identifierSchema,
          isFinance: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.position.create'),
          position: createPositionSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.position.update'),
          positionId: identifierSchema,
          patch: positionPatchSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.position.remove'),
          positionId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.episode.create'),
          title: z.string().trim().max(128).nullable().optional(),
          description: z.string().trim().max(2_000).nullable().optional(),
          deadline: dateSchema.nullable().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.episode.approve'),
          episodeId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.assignment.add'),
          episodeId: identifierSchema,
          userId: identifierSchema,
          positionId: identifierSchema.nullable().optional(),
          roleName: z.string().trim().max(64).nullable().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.assignment.remove'),
          assignmentId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.assignment.approve'),
          assignmentId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('crew.assignment.reject'),
          assignmentId: identifierSchema,
          reason: z.string().trim().min(1).max(500),
          suggestion: z.string().trim().max(500).nullable().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const CrewFinanceArgumentsSchema = z
  .object({
    schemaVersion: z.literal('crew-finance-command/v2'),
    ...commandEnvelopeShape,
    command: z
      .object({
        type: z.literal('crew.assignment.revenue.set'),
        assignmentId: identifierSchema,
        amount: z.number().int().nonnegative(),
        currency: currencySchema,
      })
      .strict(),
  })
  .strict();

export const CrewSelfServiceArgumentsSchema = z
  .object({
    schemaVersion: z.literal('crew-self-service-command/v2'),
    ...commandEnvelopeShape,
    command: z
      .object({
        type: z.literal('crew.assignment.submit'),
        assignmentId: identifierSchema,
        url: z.string().trim().url().max(1_024).nullable().optional(),
        note: z.string().trim().max(2_000).nullable().optional(),
      })
      .strict(),
  })
  .strict();

const argumentSchemas = {
  story_get_source_analysis: StorySourceAnalysisQueryArgumentsSchema,
  story_query_source_material: StorySourceMaterialQueryArgumentsSchema,
  story_get_snapshot: StoryReadArgumentsSchema,
  story_apply_change_set: StoryApplyArgumentsSchema,
  crew_get_state: CrewReadArgumentsSchema,
  crew_apply_management_command: CrewManagementArgumentsSchema,
  crew_apply_finance_command: CrewFinanceArgumentsSchema,
  crew_submit_own_assignment: CrewSelfServiceArgumentsSchema,
} as const satisfies Record<AgentDomainToolId, z.ZodType>;

export function parseAgentDomainToolArguments(
  toolId: AgentDomainToolId,
  value: unknown,
): unknown {
  return argumentSchemas[toolId].parse(value);
}

export type StoryReadArguments = z.infer<typeof StoryReadArgumentsSchema>;
export type StorySourceMaterialQueryArguments = z.infer<
  typeof StorySourceMaterialQueryArgumentsSchema
>;
export type StorySourceAnalysisQueryArguments = z.infer<
  typeof StorySourceAnalysisQueryArgumentsSchema
>;
export type StoryApplyArguments = z.infer<typeof StoryApplyArgumentsSchema>;
export type CrewReadArguments = z.infer<typeof CrewReadArgumentsSchema>;
export type CrewManagementArguments = z.infer<
  typeof CrewManagementArgumentsSchema
>;
export type CrewFinanceArguments = z.infer<typeof CrewFinanceArgumentsSchema>;
export type CrewSelfServiceArguments = z.infer<
  typeof CrewSelfServiceArgumentsSchema
>;
