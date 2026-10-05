import { CrewEarningSourceType, CrewEarningStatus } from '@prisma/client';
import { z } from 'zod';

// Minor-unit amounts cross the JSON boundary as decimal strings so the API never
// truncates a valid bigint through JavaScript's Number representation.
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
export const positiveAmountMinor = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= MAX_SIGNED_BIGINT,
    {
      message: 'The amount exceeds the supported ledger range.',
    },
  );

export const ListCrewEarningsQuerySchema = z.object({
  currency: z.enum(['CNY', 'USD']),
  scope: z.enum(['mine', 'crew']).default('mine'),
  status: z.nativeEnum(CrewEarningStatus).optional(),
  sourceType: z.nativeEnum(CrewEarningSourceType).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const ListMyCrewEarningsQuerySchema = ListCrewEarningsQuerySchema.omit({
  scope: true,
})
  .extend({ crewId: z.string().trim().min(1).max(128).optional() })
  .extend({
    recordedFrom: z.string().date().optional(),
    recordedThrough: z.string().date().optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.recordedFrom ||
      !v.recordedThrough ||
      v.recordedFrom <= v.recordedThrough,
    {
      message: 'The recorded date range must end on or after its start.',
      path: ['recordedThrough'],
    },
  );
export type ListMyCrewEarningsQuery = z.infer<
  typeof ListMyCrewEarningsQuerySchema
>;
export type ListCrewEarningsQuery = z.infer<typeof ListCrewEarningsQuerySchema>;

export const CreateCrewEarningSchema = z
  .object({
    crewMemberId: z.string().min(1),
    sourceType: z
      .nativeEnum(CrewEarningSourceType)
      .refine(
        (value) => value !== CrewEarningSourceType.task_reward,
        'Task rewards are posted only by task approval.',
      ),
    agreementId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10_000).optional(),
    currency: z.enum(['CNY', 'USD']),
    amountMinor: positiveAmountMinor,
    idempotencyKey: z.string().trim().min(8).max(80),
  })
  .superRefine((input, context) => {
    const isContract =
      input.sourceType === CrewEarningSourceType.contract_compensation;
    if (isContract && !input.agreementId) {
      context.addIssue({
        code: 'custom',
        path: ['agreementId'],
        message: 'Contract compensation must reference an agreement.',
      });
    }
    if (!isContract && input.agreementId) {
      context.addIssue({
        code: 'custom',
        path: ['agreementId'],
        message: 'Only contract compensation may reference an agreement.',
      });
    }
  });
export type CreateCrewEarningInput = z.infer<typeof CreateCrewEarningSchema>;

export const DecideCrewEarningSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2_000).optional(),
});
export type DecideCrewEarningInput = z.infer<typeof DecideCrewEarningSchema>;

export const RejectCrewEarningSchema = DecideCrewEarningSchema.extend({
  reason: z.string().trim().min(1).max(2_000),
});
export type RejectCrewEarningInput = z.infer<typeof RejectCrewEarningSchema>;

export const ReverseCrewEarningSchema = RejectCrewEarningSchema;
export type ReverseCrewEarningInput = z.infer<typeof ReverseCrewEarningSchema>;
