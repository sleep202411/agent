import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CURRENT_CELL } from '../common/region';
import { z } from 'zod';

export const FX_SCALE = 1000000n;
export const AcademyFxInput = z.strictObject({
  rate: z
    .string()
    .regex(/^(?:[1-9]\d{0,2}|0)\.\d{1,6}$/)
    .refine((v) => Number(v) > 0),
  source: z.string().trim().min(3).max(500),
  expiresAt: z.iso.datetime(),
  expectedVersion: z.number().int().min(0),
});
export type AcademyQuote = {
  currency: 'USD' | 'CNY';
  rate: string;
  source: string;
  version: number;
  expiresAt: string | null;
};
export const USD_ACADEMY_QUOTE: AcademyQuote = {
  currency: 'USD',
  rate: '1.000000',
  source: 'Academy: 100 earned credits = US$1',
  version: 0,
  expiresAt: null,
};
export function rateUnits(rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  if (!/^\d{1,3}(?:\.\d{1,6})?$/.test(rate))
    throw new BadRequestException('Invalid exchange rate.');
  const units = BigInt(whole) * FX_SCALE + BigInt(fraction.padEnd(6, '0'));
  if (units <= 0n)
    throw new BadRequestException('Exchange rate must be positive.');
  return units;
}
export function cashForCredits(credits: bigint, quote: AcademyQuote): bigint {
  return (credits * rateUnits(quote.rate)) / FX_SCALE;
}
export async function academyQuote(
  db: Pick<Prisma.TransactionClient, 'academyExchangeRate'>,
): Promise<AcademyQuote | null> {
  if (CURRENT_CELL !== 'cn') return USD_ACADEMY_QUOTE;
  const row = await db.academyExchangeRate.findUnique({
    where: { pair: 'USD/CNY' },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  rateUnits(row.rate);
  return {
    currency: 'CNY',
    rate: row.rate,
    source: row.source,
    version: row.version,
    expiresAt: row.expiresAt.toISOString(),
  };
}
export function assertQuoteCurrent(quote: AcademyQuote) {
  if (quote.expiresAt && new Date(quote.expiresAt).getTime() <= Date.now())
    throw new ConflictException(
      'The exchange-rate quote expired. Refresh your balance.',
    );
}
