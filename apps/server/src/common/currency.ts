/**
 * Multi-currency policy per cell — shared across crew positions,
 * creator-service packages, and any other money-handling feature.
 *
 * DB layer accepts any ISO 4217 code from the global whitelist (see
 * the CHECK constraints on `salary_currency` / `revenue_currency` /
 * `service_packages.currency`). This module narrows further at the
 * service layer:
 *
 *   cn cell  → CNY only (PIPL + business policy)
 *   com cell → USD only
 *
 * Add a currency: extend the whitelist below AND every DB CHECK that
 * references currency codes. The DB is the last line of defense;
 * this module is for fast fail-on-validate with helpful error
 * messages.
 */

import { BadRequestException } from '@nestjs/common';
import { ZERO_DECIMAL_CURRENCIES } from '@repo/shared/crew';
import { CURRENT_CELL } from './region';

export const ALL_CURRENCIES = [
  'CNY',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
  'AUD',
  'CAD',
  'SGD',
] as const;
export type CurrencyCode = (typeof ALL_CURRENCIES)[number];

const CN_CURRENCIES: readonly CurrencyCode[] = ['CNY'];
const COM_CURRENCIES: readonly CurrencyCode[] = ['USD'];

/** Allowed currencies for the cell this server is running in. */
export function allowedCurrencies(): readonly CurrencyCode[] {
  return CURRENT_CELL === 'cn' ? CN_CURRENCIES : COM_CURRENCIES;
}

/** Default currency a fresh form should pre-fill on each cell. */
export function defaultCurrency(): CurrencyCode {
  return CURRENT_CELL === 'cn' ? 'CNY' : 'USD';
}

/**
 * Throws BadRequest if `value` is not allowed in the current cell.
 * Pass-through for null/undefined so optional currency fields work.
 */
export function assertAllowedCurrency(
  value: string | null | undefined,
  field: string,
): void {
  if (value == null) return;
  const allowed = allowedCurrencies();
  if (!allowed.includes(value as CurrencyCode)) {
    throw new BadRequestException({
      message: `Currency '${value}' is not allowed in this region`,
      field,
      allowed,
    });
  }
}

/** Display unit → smallest currency unit (CNY fen / USD cents / JPY yen). */
export function toSmallestUnit(
  displayAmount: number,
  currency: CurrencyCode,
): bigint {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  return BigInt(
    Math.round(isZeroDecimal ? displayAmount : displayAmount * 100),
  );
}
