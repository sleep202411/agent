/**
 * DB row → wire DTO conversions for creator-services.
 *
 * The key conversion here is money: rows store BigInt in the smallest
 * currency unit; the wire shape is a `number` in the display unit
 * (yuan / dollar / yen). UI then renders directly without re-doing
 * the divide-by-100-except-JPY dance.
 */
import type { CreatorService, ServicePackage } from '@prisma/client';
import {
  compareTiers,
  startingPackage,
  type CreatorServiceCardDTO,
  type CreatorServiceDTO,
  type ServicePackageDTO,
} from '@repo/shared/creator-service';
import { ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from '@repo/shared/crew';

function smallestToDisplay(amount: bigint, currency: string): number {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency as CurrencyCode);
  // BigInt → number is safe here: smallest-unit prices are bounded by
  // the input schema (`price <= 1e8` display * 100 = 1e10 cents), well
  // inside Number.MAX_SAFE_INTEGER (~9.0e15).
  const n = Number(amount);
  return isZeroDecimal ? n : n / 100;
}

export function toPackageDTO(row: ServicePackage): ServicePackageDTO {
  return {
    id: row.id,
    tier: row.tier,
    title: row.title,
    description: row.description,
    price: smallestToDisplay(row.priceAmount, row.currency),
    currency: row.currency as CurrencyCode,
    deliveryDays: row.deliveryDays,
    revisions: row.revisions,
    scope: Array.isArray(row.scope) ? [...row.scope] : [],
  };
}

export function toServiceDTO(
  service: CreatorService,
  packages: ServicePackage[],
): CreatorServiceDTO {
  const sorted = [...packages].sort((a, b) => compareTiers(a.tier, b.tier));
  return {
    id: service.id,
    creatorId: service.creatorId,
    title: service.title,
    summary: service.summary,
    coverPath: service.coverPath,
    category: service.category as CreatorServiceDTO['category'],
    tags: Array.isArray(service.tags) ? [...service.tags] : [],
    status: service.status,
    publishedAt: service.publishedAt ? service.publishedAt.toISOString() : null,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
    version: service.version,
    packages: sorted.map(toPackageDTO),
  };
}

/**
 * Card projection for the plaza / category feed. Drops description
 * + full scope to keep the row payload small; computes the
 * "starting at" price from the cheapest tier.
 */
export function toServiceCardDTO(
  service: CreatorService,
  packages: ServicePackage[],
): CreatorServiceCardDTO {
  const dtos = packages.map(toPackageDTO);
  const cheapest = startingPackage(dtos);
  return {
    id: service.id,
    creatorId: service.creatorId,
    title: service.title,
    summary: service.summary,
    coverPath: service.coverPath,
    category: service.category as CreatorServiceCardDTO['category'],
    tags: Array.isArray(service.tags) ? [...service.tags] : [],
    publishedAt: (service.publishedAt ?? service.createdAt).toISOString(),
    startingPrice: cheapest?.price ?? 0,
    currency: (cheapest?.currency ?? 'USD') as CurrencyCode,
    startingDeliveryDays: cheapest?.deliveryDays ?? 0,
    packageCount: dtos.length,
  };
}
