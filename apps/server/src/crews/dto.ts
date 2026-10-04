import { PlotTreeSchema } from './templates/project-task-template.types';
import { ProfessionalDeliveryInput } from './tasks/task-delivery-template';
/**
 * Zod schemas for every crew controller body. Co-located in one file
 * because each schema is small and they share a few constraints
 * (positionType validation, headcount bounds, salary range).
 */
import { z } from 'zod';
import {
  ALL_CURRENCIES,
  CREW_GENRES,
  CREW_STYLES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  CREW_OWNER_ONLY_PERMISSIONS,
  CREW_PERMISSION_KEYS,
  CREW_POLICY_KEYS,
  SALARY_PERIODS,
  SOCIAL_PLATFORMS,
  WORK_MODES,
  isPresetPosition,
} from '@repo/shared/crew';

const presetPosition = z.string().refine(isPresetPosition, {
  message: 'positionType must be one of PRESET_POSITIONS',
});
const crewPolicyKey = z.enum(CREW_POLICY_KEYS);
const crewPermissionKey = z.enum(CREW_PERMISSION_KEYS);
const ownerOnlyPermissionSet = new Set<string>(CREW_OWNER_ONLY_PERMISSIONS);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

// ─── Crew CRUD ──────────────────────────────────────────────

const SocialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z.string().trim().url().max(512),
});

const ShowcaseWorkSchema = z.object({
  thumbnailUrl: z.string().trim().url().max(512),
  title: z.string().trim().min(1).max(200),
  externalUrl: z.string().trim().url().max(512).nullable().optional(),
  viewCount: z.number().int().min(0).nullable().optional(),
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'releaseDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

const CrewProfileSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2000),
  /** Square logo URL (≤512 chars). Cropped to circle in UI. */
  logo: z.string().trim().min(1).max(512),
  /** One-line hook under crew name. ≤140 chars. */
  tagline: z.string().trim().max(140).nullable().optional(),
  /** Crew taxonomy — max 5 each. */
  genres: z.array(z.enum(CREW_GENRES)).max(5).default([]),
  styles: z.array(z.enum(CREW_STYLES)).max(5).default([]),
  /** External channel links — max 10. */
  socialLinks: z.array(SocialLinkSchema).max(10).default([]),
  /** Featured works — max 10. First powers hero bg. */
  showcaseWorks: z.array(ShowcaseWorkSchema).max(10).default([]),
});

export const CreateCrewSchema = CrewProfileSchema.extend({
  productionTemplateLocale: z
    .enum(['en-US', 'zh-CN', 'zh-HK'])
    .default('en-US'),
  productionKind: z.enum(['interactive_film', 'series']).default('series'),
  studioWorkspaceId: z.string().uuid().nullable().optional(),
  createStudioWorkspace: z
    .object({
      name: z.string().trim().min(1).max(120),
    })
    .optional(),
  plotTree: PlotTreeSchema.optional(),
  storyboardClipsByNode: z
    .record(
      z.string(),
      z.array(
        z.object({
          clipId: z.string(),
          title: z.string(),
          order: z.number(),
          durationSeconds: z.number().nullable(),
        }),
      ),
    )
    .optional(),
}).refine(
  (input) => !(input.studioWorkspaceId && input.createStudioWorkspace),
  {
    message: 'Choose an existing workspace or create a new one, not both.',
    path: ['studioWorkspaceId'],
  },
);
export type CreateCrewInput = z.infer<typeof CreateCrewSchema>;

export const UpdateCrewSchema = CrewProfileSchema.partial().extend({
  /// Optimistic concurrency token from the row read prior to edit.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateCrewInput = z.infer<typeof UpdateCrewSchema>;

export const UpdateCrewListingSchema = z.object({
  listingStatus: z.enum(['unlisted', 'listed']),
  /// Optimistic concurrency token from the row read prior to action.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateCrewListingInput = z.infer<typeof UpdateCrewListingSchema>;

export const TransferCrewOwnerSchema = z.object({
  /// External auth user id (raw Java user id) of the incoming owner.
  toUserId: z.string().trim().min(1).max(64),
  /// Whether to drop the outgoing owner from the crew. Default (false)
  /// keeps them as a normal member.
  removeOldOwner: z.boolean().optional(),
  /// Optimistic concurrency token from the row read prior to action.
  expectedVersion: z.number().int().min(0).optional(),
});
export type TransferCrewOwnerInput = z.infer<typeof TransferCrewOwnerSchema>;

// ─── Admin moderation ───────────────────────────────────────

/** Admin crew patrol list — search + moderation-status filter, cursor paged. */
export const ListAdminCrewsQuerySchema = z
  .object({
    /** Free-text match on crew name or exact id. */
    q: z.string().trim().max(128).optional(),
    /** Filter by platform moderation state. Omit for all. */
    moderationStatus: z.enum(['ok', 'taken_down']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type ListAdminCrewsQuery = z.infer<typeof ListAdminCrewsQuerySchema>;

/** Set a crew's moderation state (takedown / restore) with an audit reason. */
export const SetCrewModerationSchema = z
  .object({
    status: z.enum(['ok', 'taken_down']),
    /** Required when taking down; the reason is stamped for the audit trail. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.status !== 'taken_down' || !!v.reason?.trim(), {
    message: 'A reason is required when taking a crew down.',
    path: ['reason'],
  });
export type SetCrewModerationInput = z.infer<typeof SetCrewModerationSchema>;

/** Admin recruitment-posting patrol — search + status filter, cursor paged. */
export const ListAdminPositionsQuerySchema = z
  .object({
    /** Free-text match on crew name, position type, or exact position id. */
    q: z.string().trim().max(128).optional(),
    moderationStatus: z.enum(['ok', 'taken_down']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type ListAdminPositionsQuery = z.infer<
  typeof ListAdminPositionsQuerySchema
>;

/** Set a recruitment posting's moderation state (takedown / restore). */
export const SetPositionModerationSchema = z
  .object({
    status: z.enum(['ok', 'taken_down']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.status !== 'taken_down' || !!v.reason?.trim(), {
    message: 'A reason is required when taking a posting down.',
    path: ['reason'],
  });
export type SetPositionModerationInput = z.infer<
  typeof SetPositionModerationSchema
>;

// ─── Position CRUD ──────────────────────────────────────────

/// Salary block validated as a unit so we can express "max >= min"
/// and "currency required when amounts set". Display unit comes from
/// the UI — server converts to smallest currency unit at the service
/// layer (×100 for most, ×1 for JPY).
const SalarySchema = z
  .object({
    period: z.enum(SALARY_PERIODS).nullable().optional(),
    currency: z.enum(ALL_CURRENCIES).nullable().optional(),
    /// Display unit (yuan / dollar / etc.) — converted to smallest unit
    /// server-side based on the chosen currency.
    min: z.number().min(0).max(100_000_000).nullable().optional(),
    max: z.number().min(0).max(100_000_000).nullable().optional(),
    negotiable: z.boolean().optional(),
  })
  .refine((s) => s.min == null || s.max == null || s.max >= s.min, {
    message: 'salary.max must be >= salary.min',
    path: ['max'],
  })
  .refine((s) => (s.min == null && s.max == null) || s.currency != null, {
    message: 'salary.currency required when amounts are set',
    path: ['currency'],
  });

const ExpectedCompensationSchema = z
  .object({
    /// Display unit (yuan / dollar / yen). Server converts to smallest unit.
    amount: z.number().min(0).max(100_000_000).nullable().optional(),
    currency: z.enum(ALL_CURRENCIES).nullable().optional(),
    period: z.enum(SALARY_PERIODS).nullable().optional(),
  })
  .refine((v) => v.amount == null || v.currency != null, {
    message: 'expectedCompensation.currency required when amount is set',
    path: ['currency'],
  });

const PositionBaseSchema = z.object({
  positionType: presetPosition,
  description: z.string().trim().min(1).max(10000),
  targetCount: z.number().int().min(1).max(99),
  workMode: z.enum(WORK_MODES).default('remote'),
  location: z.string().trim().min(1).max(128).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('project_based'),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).default('any'),
  requiredSkills: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  salary: SalarySchema.optional(),
  /// Tenure in months (1-60). NULL/undefined = open-ended commitment
  /// — see CrewPosition.durationMonths comment in schema.prisma.
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
  /// Revenue share percentage offered to this position holder.
  /// Wire is a plain percentage (e.g. 2.5 for 2.5 %); server stores
  /// basis points internally. 0.5 minimum keeps the value meaningful
  /// (smaller shares are noise), 50 max caps a single seat at half.
  revenueSharePercent: z
    .number()
    .min(0.5)
    .max(50)
    .multipleOf(0.5)
    .nullable()
    .optional(),
  /// YYYY-MM-DD; client supplies ISO date string.
  closeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'closeDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export const CreatePositionSchema = PositionBaseSchema.extend({
  taskId: z.string().uuid().optional(),
  recruitmentVisibility: z.enum(['public', 'private']).optional(),
}).refine(
  (p) =>
    p.workMode === 'remote' || (p.location != null && p.location.length > 0),
  {
    message: 'location is required when workMode != remote',
    path: ['location'],
  },
);
export type CreatePositionInput = z.infer<typeof CreatePositionSchema>;

export const UpdatePositionSchema = PositionBaseSchema.partial().extend({
  /// owner-toggle status. 'full' is service-managed.
  status: z.enum(['open', 'frozen']).optional(),
});
export type UpdatePositionInput = z.infer<typeof UpdatePositionSchema>;

function commaSeparatedEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  field: string,
) {
  const allowed = new Set<string>(values);
  return z
    .string()
    .trim()
    .max(256)
    .optional()
    .transform((raw, ctx): T[number][] => {
      if (!raw) return [];
      const items = [
        ...new Set(raw.split(',').map((value) => value.trim())),
      ].filter(Boolean);
      const invalid = items.find((value) => !allowed.has(value));
      if (invalid) {
        ctx.addIssue({
          code: 'custom',
          message: `${field} contains unsupported value "${invalid}"`,
        });
        return z.NEVER;
      }
      return items as T[number][];
    });
}

export const ListPublicPositionsQuerySchema = z
  .object({
    positionType: presetPosition.optional(),
    genre: z.enum(CREW_GENRES).optional(),
    salaryMinMinor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,15})$/)
      .optional(),
    salaryMaxMinor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,15})$/)
      .optional(),
    salaryCurrency: z.enum(['USD', 'CNY']).optional(),
    salaryPeriod: z.enum(SALARY_PERIODS).optional(),
    saved: z.enum(['true', 'false']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
    crewId: z.string().trim().min(1).max(100).optional(),
    skill: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(36),
    cursor: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
      .optional(),
    employment: commaSeparatedEnum(EMPLOYMENT_TYPES, 'employment'),
    seniority: commaSeparatedEnum(EXPERIENCE_LEVELS, 'seniority'),
    workMode: commaSeparatedEnum(WORK_MODES, 'workMode'),
    sort: z.enum(['newest', 'oldest']).default('newest'),
  })
  .superRefine((value, ctx) => {
    if (
      (value.salaryMinMinor !== undefined ||
        value.salaryMaxMinor !== undefined) &&
      (!value.salaryCurrency || !value.salaryPeriod)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Salary filters require a currency and pay period.',
        path: ['salaryCurrency'],
      });
    if (
      value.salaryMinMinor !== undefined &&
      value.salaryMaxMinor !== undefined &&
      BigInt(value.salaryMinMinor) > BigInt(value.salaryMaxMinor)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Minimum salary must not exceed maximum salary.',
        path: ['salaryMaxMinor'],
      });
  });
export type ListPublicPositionsQuery = z.infer<
  typeof ListPublicPositionsQuerySchema
>;

export const ListCrewPositionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
    .optional(),
});
export type ListCrewPositionsQuery = z.infer<
  typeof ListCrewPositionsQuerySchema
>;

// ─── Application ────────────────────────────────────────────

export const ApplySchema = z.object({
  message: z.string().trim().min(1).max(1000).nullable().optional(),
  portfolioUrl: z
    .string()
    .trim()
    .url('portfolioUrl must be a valid URL')
    .max(512)
    .nullable()
    .optional(),
  expectedCompensation: ExpectedCompensationSchema.nullable().optional(),
  availableStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'availableStartDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
});
export type ApplyInput = z.infer<typeof ApplySchema>;

export const ListCrewApplicationsQuerySchema = z.object({
  scope: z.enum(['sent', 'received']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
    .optional(),
  positionId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'positionId is invalid')
    .optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
export type ListCrewApplicationsQuery = z.infer<
  typeof ListCrewApplicationsQuerySchema
>;

// ─── Crew collaboration ─────────────────────────────────────

const InvitationAgreementRequestSchema = z.object({
  signerName: z.string().trim().min(1).max(128),
  signerEmail: z.string().trim().email().max(320),
  title: z.string().trim().min(1).max(180),
});

const CrewMemberPositionInputSchema = z
  .object({
    categoryKey: presetPosition.nullable().optional(),
    title: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .refine((value) => value.categoryKey != null || value.title != null, {
    message: 'A standard position or custom title is required',
  });

export const CreateCrewInvitationSchema = z
  .object({
    positionCategory: presetPosition.optional(),
    account: z.string().trim().min(1).max(120),
    lookupBy: z.enum(['contact', 'userId']).optional(),
    policyKeys: z.array(crewPolicyKey).max(CREW_POLICY_KEYS.length).default([]),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    agreement: InvitationAgreementRequestSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const valid =
      input.lookupBy === 'userId'
        ? /^\d{1,18}$/.test(input.account)
        : EMAIL_RE.test(input.account) || PHONE_RE.test(input.account);
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['account'],
        message:
          input.lookupBy === 'userId'
            ? 'account must be a numeric user ID (1–18 digits)'
            : 'account must be a valid email or phone',
      });
  });
export type CreateCrewInvitationInput = z.infer<
  typeof CreateCrewInvitationSchema
>;

/**
 * A shareable link, not a named invitation: there is no account to resolve, so
 * the creator instead bounds who may use it. Both bounds are optional and both
 * are open-ended by omission — an unbounded link is a real product choice, and
 * revoke is always available.
 */
export const CreateCrewInviteLinkSchema = z
  .object({
    /** Omitted by the existing member-invite UI; community links opt in explicitly. */
    kind: z.enum(['member', 'community']).default('member'),
    policyKeys: z.array(crewPolicyKey).max(CREW_POLICY_KEYS.length).default([]),
    /** Omit for a link that never expires. */
    expiresInDays: z.number().int().min(1).max(365).optional(),
    /** Omit for unlimited joins. */
    maxUses: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type CreateCrewInviteLinkInput = z.infer<
  typeof CreateCrewInviteLinkSchema
>;

export const ListCrewInvitationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
    .optional(),
});
export type ListCrewInvitationsQuery = z.infer<
  typeof ListCrewInvitationsQuerySchema
>;

export const ListCrewMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(2).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
    .optional(),
});
export type ListCrewMembersQuery = z.infer<typeof ListCrewMembersQuerySchema>;

export const UpdateMemberSchema = z
  .object({
    positions: z.array(CrewMemberPositionInputSchema).max(12).optional(),
    policyKeys: z.array(crewPolicyKey).max(CREW_POLICY_KEYS.length).optional(),
    permissionOverrides: z
      .array(
        z
          .object({
            permissionKey: crewPermissionKey,
            effect: z.enum(['allow', 'deny']),
          })
          .refine((value) => !ownerOnlyPermissionSet.has(value.permissionKey), {
            message: 'Owner-only permissions cannot be overridden',
          }),
      )
      .max(CREW_PERMISSION_KEYS.length)
      .optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine(
    (input) =>
      input.positions !== undefined ||
      input.policyKeys !== undefined ||
      input.permissionOverrides !== undefined,
    { message: 'At least one member field must be changed' },
  );
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

export const CreateCrewAgreementSchema = z.object({
  memberUserId: z.string().trim().min(1).max(64),
  signerName: z.string().trim().min(1).max(128),
  signerEmail: z.string().trim().email().max(320),
  title: z.string().trim().min(1).max(180),
});
export type CreateCrewAgreementInput = z.infer<
  typeof CreateCrewAgreementSchema
>;

export const ListCrewAgreementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'cursor is invalid')
    .optional(),
  view: z.enum(['all', 'active', 'signed', 'attention']).default('all'),
});
export type ListCrewAgreementsQuery = z.infer<
  typeof ListCrewAgreementsQuerySchema
>;

const TaskAssigneeSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  /// Integer minor units for CNY/USD.
  /// Task approval copies the amount and currency unchanged to the immutable ledger.
  currency: z.enum(['CNY', 'USD']),
  rewardAmountMinor: z
    .number()
    .int()
    .min(1)
    .max(10_000_000_000)
    .nullable()
    .optional(),
});

export const TaskCustomFieldValueSchema = z
  .object({
    fieldId: z.string().uuid(),
    /// `null` removes the sparse value row. Runtime validation against the
    /// field definition happens inside the task transaction.
    value: z.union([
      z.string().max(4_000),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(128)).max(50),
      z.null(),
    ]),
  })
  .strict();

export const CreateCrewTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10_000).default(''),
    workflowStateId: z.string().uuid().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    estimatePoints: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    rewardUsdMinor: z
      .number()
      .int()
      .min(0)
      .max(100_000_000_000)
      .nullable()
      .optional(),
    positionRole: z.string().trim().min(1).max(80).nullable().optional(),
    contractAssetNodeId: z.string().uuid().nullable().optional(),
    requiredSkills: z
      .array(z.string().trim().min(1).max(64))
      .max(20)
      .optional(),
    profitShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
    computeBudgetPoints: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .nullable()
      .optional(),
    revisionLimit: z.number().int().min(0).max(100).nullable().optional(),
    cycleId: z.string().uuid().nullable().optional(),
    episodeId: z.string().uuid().nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    blockedByTaskIds: z.array(z.string().uuid()).max(50).default([]),
    customFieldValues: z.array(TaskCustomFieldValueSchema).max(50).default([]),
    labelIds: z.array(z.string().uuid()).max(20).default([]),
    assignees: z.array(TaskAssigneeSchema).max(30).default([]),
    taskKind: z
      .enum([
        'script',
        'gameplay',
        'plot_tree',
        'art',
        'storyboard',
        'voice',
        'music',
        'edit',
        'qa',
        'other',
      ])
      .nullable()
      .optional(),
  })
  .superRefine((input, ctx) => {
    const required = {
      description: input.description.trim(),
      taskKind: input.taskKind,
      dueAt: input.dueAt,
      rewardUsdMinor: input.rewardUsdMinor,
    };
    for (const [field, value] of Object.entries(required)) {
      if (value == null || value === '')
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required`,
        });
    }
  })
  .refine(
    (input) =>
      input.startAt == null ||
      input.dueAt == null ||
      new Date(input.dueAt) >= new Date(input.startAt),
    {
      path: ['dueAt'],
      message: 'Task due date must be on or after its start date',
    },
  );
export type CreateCrewTaskInput = z.infer<typeof CreateCrewTaskSchema>;

export const DraftCrewTaskSchema = z
  .object({
    prompt: z.string().trim().min(3).max(4_000),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']).default('en-US'),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(
        /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/,
        'timeZone must be an IANA time zone',
      )
      .default('UTC'),
    memberHints: z
      .array(
        z
          .object({
            userId: z.string().trim().min(1).max(64),
            displayName: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type DraftCrewTaskInput = z.infer<typeof DraftCrewTaskSchema>;

export interface CrewTaskDraft {
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  startDate: string | null;
  dueDate: string | null;
  estimatePoints: number | null;
  revisionLimit: number | null;
  cycleId: string | null;
  parentId: string | null;
  blockedByTaskIds: string[];
  assigneeUserIds: string[];
  questions: string[];
}

export const CloseCrewTaskSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export type CloseCrewTaskInput = z.infer<typeof CloseCrewTaskSchema>;

export const UpdateCrewTaskSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(10_000).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    estimatePoints: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    rewardUsdMinor: z
      .number()
      .int()
      .min(0)
      .max(100_000_000_000)
      .nullable()
      .optional(),
    positionRole: z.string().trim().min(1).max(80).nullable().optional(),
    contractAssetNodeId: z.string().uuid().nullable().optional(),
    requiredSkills: z
      .array(z.string().trim().min(1).max(64))
      .max(20)
      .optional(),
    profitShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
    computeBudgetPoints: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .nullable()
      .optional(),
    revisionLimit: z.number().int().min(0).max(100).nullable().optional(),
    cycleId: z.string().uuid().nullable().optional(),
    episodeId: z.string().uuid().nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    blockedByTaskIds: z.array(z.string().uuid()).max(50).optional(),
    customFieldValues: z.array(TaskCustomFieldValueSchema).max(50).optional(),
    labelIds: z.array(z.string().uuid()).max(20).optional(),
    workflowStateId: z.string().uuid().optional(),
    assignees: z.array(TaskAssigneeSchema).max(30).optional(),
    taskKind: z
      .enum([
        'script',
        'gameplay',
        'plot_tree',
        'art',
        'storyboard',
        'voice',
        'music',
        'edit',
        'qa',
        'other',
      ])
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([field, value]) => field !== 'expectedVersion' && value !== undefined,
      ),
    { message: 'At least one task field must be changed' },
  );
export type UpdateCrewTaskInput = z.infer<typeof UpdateCrewTaskSchema>;

const TaskMentionSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((label) => !/[@\r\n]/.test(label), {
      message: 'Mention label cannot contain @ or a line break',
    }),
});

const TaskCommentAttachmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((name) => name !== '.' && name !== '..', {
    message: 'Attachment name cannot be "." or ".."',
  })
  .refine((name) => !name.includes('/'), {
    message: 'Attachment name cannot contain "/"',
  });

const TaskCommentAttachmentSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('asset'),
    assetNodeId: z.string().uuid(),
  }),
  z.object({
    source: z.literal('upload'),
    mediaAssetId: z.string().uuid(),
    name: TaskCommentAttachmentNameSchema,
  }),
]);

const TaskCommentAttachmentsSchema = z
  .array(TaskCommentAttachmentSchema)
  .max(10)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const key =
        item.source === 'asset'
          ? `asset:${item.assetNodeId}`
          : `upload:${item.mediaAssetId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'The same attachment cannot be added twice',
        });
      }
      seen.add(key);
    });
  });

export const ListCrewTaskTimelineQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListCrewTaskTimelineQuery = z.infer<
  typeof ListCrewTaskTimelineQuerySchema
>;

export const CreateCrewTaskCommentSchema = z
  .object({
    body: z.string().trim().max(10_000).default(''),
    mentions: z.array(TaskMentionSchema).max(20).default([]),
    replyToId: z.string().uuid().nullable().optional(),
    attachments: TaskCommentAttachmentsSchema.default([]),
    clientKey: z.string().trim().min(1).max(64),
  })
  .strict()
  .refine((input) => input.body.length > 0 || input.attachments.length > 0, {
    message: 'A comment needs text or at least one attachment',
  });
export type CreateCrewTaskCommentInput = z.infer<
  typeof CreateCrewTaskCommentSchema
>;

export const UpdateCrewTaskCommentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    body: z.string().trim().min(1).max(10_000),
    mentions: z.array(TaskMentionSchema).max(20).default([]),
  })
  .strict();
export type UpdateCrewTaskCommentInput = z.infer<
  typeof UpdateCrewTaskCommentSchema
>;

export const SetTaskDeliveryFolderSchema = z
  .object({
    deliveryFolderId: z.string().uuid().nullable(),
  })
  .strict();
export type SetTaskDeliveryFolderInput = z.infer<
  typeof SetTaskDeliveryFolderSchema
>;

export const SubmitCrewTaskSchema = z.object({
  professionalDelivery: ProfessionalDeliveryInput.optional(),
  deliveryFolderId: z.string().uuid().optional(),
  note: z.string().trim().max(5000).default(''),
  assetNodeIds: z.array(z.string().uuid()).max(100).default([]),
});
export type SubmitCrewTaskInput = z.infer<typeof SubmitCrewTaskSchema>;

export const ReviewCrewTaskSchema = z
  .object({
    expectedSubmissionId: z.string().uuid(),
    decision: z.enum(['approve', 'request_revision']),
    revisionDueAt: z.string().datetime({ offset: true }).optional(),
    bindAssetNodeId: z.string().uuid().optional(),
    note: z.string().trim().max(5000).default(''),
  })
  .refine((input) => input.decision === 'approve' || input.note.length > 0, {
    path: ['note'],
    message: 'Revision instructions are required when requesting changes',
  })
  .refine(
    (input) =>
      input.revisionDueAt === undefined ||
      input.decision === 'request_revision',
    {
      path: ['revisionDueAt'],
      message: 'Only a revision request can extend the deadline.',
    },
  );
export type ReviewCrewTaskInput = z.infer<typeof ReviewCrewTaskSchema>;

export const CreateCrewTaskKindTemplateSchema = z
  .object({
    kind: z.enum([
      'script',
      'gameplay',
      'plot_tree',
      'art',
      'storyboard',
      'voice',
      'music',
      'edit',
      'qa',
      'other',
    ]),
    name: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10_000).default(''),
  })
  .strict();
export type CreateCrewTaskKindTemplateInput = z.infer<
  typeof CreateCrewTaskKindTemplateSchema
>;

export const LinkCrewStudioMediaSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    mediaAssetIds: z.array(z.string().uuid()).min(1).max(40),
    projectId: z.string().uuid().nullable().optional(),
    storyProjectId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type LinkCrewStudioMediaInput = z.infer<
  typeof LinkCrewStudioMediaSchema
>;

export const SetCrewAssetStudioLinkSchema = z
  .object({
    mediaAssetId: z.string().uuid().nullable(),
    projectId: z.string().uuid().nullable().optional(),
    storyProjectId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type SetCrewAssetStudioLinkInput = z.infer<
  typeof SetCrewAssetStudioLinkSchema
>;

// ─── Viewer moderation ──────────────────────────────────────

/** Same reason set as ip-commerce content reports (shared moderation queue). */
export const CreateCrewReportSchema = z
  .object({
    reason: z.enum([
      'copyright',
      'unsafe_content',
      'fraud',
      'misleading',
      'privacy',
      'harassment',
      'other',
    ]),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateCrewReportInput = z.infer<typeof CreateCrewReportSchema>;
