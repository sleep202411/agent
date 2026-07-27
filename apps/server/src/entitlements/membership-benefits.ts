/**
 * Membership benefits — the ONE source of truth for what a plan grants.
 *
 * Stored as the validated `benefits` JSONB column on
 * `billing_membership_plans` and edited through the billing admin API.
 * Unlimited daily caps are stored as the JSON string `"Infinity"`
 * (JSON has no Infinity literal); `benefitsToSnapshotLimits` converts
 * to real numbers for runtime consumers.
 *
 * The ONLY code-defined benefits object is `DEFAULT_FREE_BENEFITS` —
 * the `free` plan is not sold as a row. Every other plan's benefits
 * MUST come from its active plan row; an active row with invalid
 * benefits fails loud at resolution time.
 */
import { z } from 'zod';
import type { QuotaLimits } from '../quota/quota.types';
import type { EntitlementSnapshot } from './entitlement.types';

/** Daily cap: non-negative integer, or the JSON-safe `"Infinity"` marker. */
const DailyLimitSchema = z.union([
  z.number().int().min(0),
  z.literal('Infinity'),
]);

const NullableJobLimitSchema = z.number().int().min(0).nullable();

export const MembershipBenefitsSchema = z
  .object({
    /** BullMQ priority — smaller = served first under contention. */
    queuePriority: z.number().int().min(0).max(100),
    imageDaily: DailyLimitSchema,
    videoDaily: DailyLimitSchema,
    chatDaily: DailyLimitSchema,
    workflowDaily: DailyLimitSchema,
    /** Upload is a hard cap for EVERY plan — permanent storage cost. */
    uploadMB: z.number().int().min(0),
    /** Chat per-minute rate limit. Applies to ALL plans (script abuse). */
    chatPerMinute: z.number().int().min(0),
    /** `null` = contract-managed/unlimited. */
    concurrentJobs: NullableJobLimitSchema,
    /** `null` = contract-managed/unlimited. */
    queuedJobs: NullableJobLimitSchema,
    features: z
      .object({
        aiGeneration: z.boolean(),
        advancedModelAccess: z.boolean(),
        advancedParameters: z.boolean(),
        teamSharedCredits: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type MembershipBenefits = z.infer<typeof MembershipBenefitsSchema>;

/**
 * Benefits of the `free` plan — the only plan without a sold row and
 * therefore the only benefits object defined in code.
 */
export const DEFAULT_FREE_BENEFITS: MembershipBenefits = {
  queuePriority: 10,
  imageDaily: 5,
  videoDaily: 0,
  chatDaily: 30,
  workflowDaily: 3,
  uploadMB: 100,
  chatPerMinute: 20,
  concurrentJobs: 1,
  queuedJobs: 2,
  features: {
    aiGeneration: true,
    advancedModelAccess: false,
    advancedParameters: false,
    teamSharedCredits: false,
  },
};

export class InvalidMembershipBenefitsError extends Error {
  constructor(
    public readonly planKey: string,
    public readonly issues: string[],
  ) {
    super(
      `Membership plan "${planKey}" has invalid benefits: ${issues.join('; ')}`,
    );
    this.name = 'InvalidMembershipBenefitsError';
  }
}

/** Parse a plan row's stored benefits. Throws loud on any deviation. */
export function parseMembershipBenefits(
  planKey: string,
  value: unknown,
): MembershipBenefits {
  const parsed = MembershipBenefitsSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidMembershipBenefitsError(
      planKey,
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}

function dailyLimitToNumber(value: number | 'Infinity'): number {
  return value === 'Infinity' ? Number.POSITIVE_INFINITY : value;
}

/** Runtime limits block of the entitlement snapshot. */
export function benefitsToSnapshotLimits(
  benefits: MembershipBenefits,
): EntitlementSnapshot['limits'] {
  return {
    queuePriority: benefits.queuePriority,
    imageDaily: dailyLimitToNumber(benefits.imageDaily),
    videoDaily: dailyLimitToNumber(benefits.videoDaily),
    chatDaily: dailyLimitToNumber(benefits.chatDaily),
    workflowDaily: dailyLimitToNumber(benefits.workflowDaily),
    uploadMB: benefits.uploadMB,
    chatPerMinute: benefits.chatPerMinute,
    concurrentJobs: benefits.concurrentJobs,
    queuedJobs: benefits.queuedJobs,
  };
}

/** Per-dimension caps handed into QuotaService. */
export function benefitsToQuotaLimits(
  benefits: MembershipBenefits,
): QuotaLimits {
  return {
    imageDaily: dailyLimitToNumber(benefits.imageDaily),
    videoDaily: dailyLimitToNumber(benefits.videoDaily),
    chatDaily: dailyLimitToNumber(benefits.chatDaily),
    workflowDaily: dailyLimitToNumber(benefits.workflowDaily),
    uploadMB: benefits.uploadMB,
    chatPerMinute: benefits.chatPerMinute,
  };
}
