import { z } from 'zod';
import { positiveAmountMinor } from '../crews/earnings/earnings.dto';

/** The amount is confirmed distributable cash, never contract face value or points. */
export const ConfirmedRevenueAllocation = z
  .strictObject({
    currency: z.enum(['USD', 'CNY']),
    amountMinor: positiveAmountMinor,
    participants: z
      .array(
        z.strictObject({
          crewMemberId: z.string().trim().min(1).max(128),
          shareBps: z.number().int().min(1).max(10000),
        }),
      )
      .min(1)
      .max(1000),
  })
  .superRefine(({ participants }, ctx) => {
    const ids = new Set<string>();
    let total = 0;
    for (const [index, participant] of participants.entries()) {
      if (ids.has(participant.crewMemberId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['participants', index, 'crewMemberId'],
          message: 'Each beneficiary must appear only once.',
        });
      }
      ids.add(participant.crewMemberId);
      total += participant.shareBps;
    }
    if (total !== 10000) {
      ctx.addIssue({
        code: 'custom',
        path: ['participants'],
        message:
          'Beneficiary shares must total 100% of the distributable amount.',
      });
    }
  });

/**
 * Largest remainders receive the remaining minor units; equal remainders are
 * ordered by member ID, so rearranging form rows cannot change a payment.
 * The admin must see and confirm these exact amounts before posting.
 * Keep zero-value shares in the receipt; they do not create earning entries.
 */
export function allocateConfirmedRevenue(
  raw: z.input<typeof ConfirmedRevenueAllocation>,
) {
  const input = ConfirmedRevenueAllocation.parse(raw);
  const amount = BigInt(input.amountMinor);
  const rows = input.participants.map(({ crewMemberId, shareBps }) => {
    const product = amount * BigInt(shareBps);
    return {
      crewMemberId,
      shareBps,
      amount: product / 10000n,
      remainder: product % 10000n,
    };
  });
  rows.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.crewMemberId < b.crewMemberId ? -1 : 1;
  });
  let remaining = amount - rows.reduce((sum, row) => sum + row.amount, 0n);
  for (const row of rows) {
    if (remaining === 0n) break;
    row.amount += 1n;
    remaining -= 1n;
  }
  return {
    currency: input.currency,
    amountMinor: amount.toString(),
    participants: rows
      .sort((a, b) => (a.crewMemberId < b.crewMemberId ? -1 : 1))
      .map(({ crewMemberId, shareBps, amount: allocated }) => ({
        crewMemberId,
        shareBps,
        amountMinor: allocated.toString(),
      })),
  };
}
