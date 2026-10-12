import { BadRequestException } from '@nestjs/common';
import { CURRENT_CELL } from '../../common/region';

export function crewCurrency(): 'CNY' | 'USD' {
  return CURRENT_CELL === 'cn' ? 'CNY' : 'USD';
}

export function assertNewCrewCurrency(
  currency: string | null | undefined,
  field = 'currency',
): void {
  if (currency == null) return;
  if (currency !== 'USD' && currency !== 'CNY')
    throw new BadRequestException({
      code: 'CREW_CURRENCY_MISMATCH',
      field,
      message: 'Crew amounts must use USD or CNY integer minor units.',
    });
}

export function formatLedgerAmount(amount: bigint, currency: string): string {
  const absolute = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
