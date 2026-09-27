import { CrewPayoutMethod, CrewPayoutStatus } from '@prisma/client';
import { z } from 'zod';
import { positiveAmountMinor } from './earnings.dto';

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const nonNegativeMinorUnits = z
  .string()
  .regex(/^\d+$/)
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) <= MAX_SIGNED_BIGINT,
    {
      message: 'The amount exceeds the supported payout range.',
    },
  );
export const ListCrewPayoutsQuerySchema = z.object({
  currency: z.enum(['CNY', 'USD']),
  scope: z.enum(['mine', 'crew']).default('mine'),
  status: z.nativeEnum(CrewPayoutStatus).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const ListMyCrewPayoutsQuerySchema = ListCrewPayoutsQuerySchema.omit({
  scope: true,
})
  .extend({ crewId: z.string().trim().min(1).max(128).optional() })
  .strict();
export type ListMyCrewPayoutsQuery = z.infer<
  typeof ListMyCrewPayoutsQuerySchema
>;
export type ListCrewPayoutsQuery = z.infer<typeof ListCrewPayoutsQuerySchema>;

export const CreateCrewPayoutSchema = z.object({
  crewMemberId: z.string().trim().min(1),
  currency: z.enum(['CNY', 'USD']),
  amountMinor: positiveAmountMinor,
  withholdingAmountMinor: nonNegativeMinorUnits.default('0'),
  note: z.string().trim().max(10_000).optional(),
  idempotencyKey: z.string().trim().min(8).max(80),
});
export type CreateCrewPayoutInput = z.infer<typeof CreateCrewPayoutSchema>;

const PayoutVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const PayCrewPayoutSchema = PayoutVersionSchema.extend({
  paymentMethod: z.nativeEnum(CrewPayoutMethod),
  paymentReference: z.string().trim().min(1).max(180),
  paymentProofUrl: z.string().trim().url().max(1024).optional(),
});
export type PayCrewPayoutInput = z.infer<typeof PayCrewPayoutSchema>;

export const VoidCrewPayoutSchema = PayoutVersionSchema.extend({
  reason: z.string().trim().min(1).max(2_000),
});
export type VoidCrewPayoutInput = z.infer<typeof VoidCrewPayoutSchema>;
