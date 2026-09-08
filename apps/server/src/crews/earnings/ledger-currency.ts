import { BadRequestException } from '@nestjs/common';
import { CURRENT_CELL } from '../../common/region';

export function crewCurrency(): 'CNY' | 'USD' {
  return CURRENT_CELL === 'cn' ? 'CNY' : 'USD';
}

export function assertNewCrewCurrency(currency: string): void {
  if (currency !== crewCurrency())
    throw new BadRequestException({
      code: 'CREW_CURRENCY_MISMATCH',
      message: `New Crew amounts must use ${crewCurrency()} integer minor units.`,
    });
}

export function formatLedgerAmount(amount: bigint, currency: string): string {
  const absolute = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
