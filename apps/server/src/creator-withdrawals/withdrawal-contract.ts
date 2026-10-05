import { z } from 'zod';
const MAX_AMOUNT = 9_223_372_036_854_775_807n;
export const WithdrawalCurrency = z.enum(['USD', 'CNY']);
export const WithdrawalRecipient = z.strictObject({
  fullName: z.string().trim().min(1).max(200),
  accountNumber: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(1000),
  swift: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/),
  branchAddress: z.string().trim().min(1).max(1000),
});
export const RequestWithdrawal = z.strictObject({
  requestId: z.uuid(),
  currency: WithdrawalCurrency,
  // 100 basis points = 1%. No floating point arithmetic for money.
  percentageBps: z.number().int().min(1).max(10000),
  expectedAvailableAmountMinor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => BigInt(value) <= MAX_AMOUNT),
  recipient: WithdrawalRecipient,
});
/** Called against the locked authoritative balance; the displayed preview is
 * not authorization to silently withdraw more after a new task is approved. */
export function calculateWithdrawalAmount(
  available: bigint,
  percentageBps: number,
): bigint {
  if (available <= 0n || available > MAX_AMOUNT)
    throw new Error('No supported withdrawable balance.');
  if (
    !Number.isInteger(percentageBps) ||
    percentageBps < 1 ||
    percentageBps > 10000
  )
    throw new Error('Invalid withdrawal percentage.');
  const amount = (available * BigInt(percentageBps)) / 10000n;
  if (amount <= 0n)
    throw new Error(
      'The selected percentage is less than one minor currency unit.',
    );
  return amount;
}
