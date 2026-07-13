import {
  capacityTiersFromCatalogSnapshot,
  selectProviderCapacity,
} from './provider-capacity';
import type { AiProviderCapacitySnapshot } from './types';

const BASE: AiProviderCapacitySnapshot = {
  maxConcurrentRequests: null,
  maxRequestsPerMinute: null,
  requestTimeoutSeconds: 1800,
  cooldownSeconds: null,
  failureThreshold: null,
};

describe('capacityTiersFromCatalogSnapshot', () => {
  it('parses the seedance 4k lane shape', () => {
    const tiers = capacityTiersFromCatalogSnapshot({
      capacityTiers: {
        resolution: {
          '4k': { maxConcurrentRequests: 1, maxRequestsPerMinute: 15 },
        },
      },
    });
    expect(tiers?.resolution?.['4k']).toMatchObject({
      maxConcurrentRequests: 1,
      maxRequestsPerMinute: 15,
    });
  });

  it('returns undefined for absent/malformed snapshots', () => {
    expect(capacityTiersFromCatalogSnapshot(undefined)).toBeUndefined();
    expect(capacityTiersFromCatalogSnapshot({})).toBeUndefined();
    expect(
      capacityTiersFromCatalogSnapshot({ capacityTiers: 'nope' }),
    ).toBeUndefined();
    expect(
      capacityTiersFromCatalogSnapshot({ capacityTiers: { resolution: 7 } }),
    ).toBeUndefined();
  });

  it('drops non-object tier entries and coerces bad numbers to null', () => {
    const tiers = capacityTiersFromCatalogSnapshot({
      capacityTiers: {
        resolution: {
          '4k': { maxConcurrentRequests: '1', maxRequestsPerMinute: 15.9 },
          '720p': 'nope',
        },
      },
    });
    expect(tiers?.resolution?.['720p']).toBeUndefined();
    expect(tiers?.resolution?.['4k']).toMatchObject({
      maxConcurrentRequests: null,
      maxRequestsPerMinute: 15,
    });
  });
});

describe('selectProviderCapacity', () => {
  const tiers = capacityTiersFromCatalogSnapshot({
    capacityTiers: {
      resolution: {
        '4k': { maxConcurrentRequests: 1, maxRequestsPerMinute: 15 },
      },
    },
  });

  it('returns the base capacity when no tier matches', () => {
    expect(selectProviderCapacity(BASE, tiers, '1080p')).toBe(BASE);
    expect(selectProviderCapacity(BASE, tiers, undefined)).toBe(BASE);
    expect(selectProviderCapacity(BASE, undefined, '4k')).toBe(BASE);
  });

  it('applies the matching tier with a bucket-splitting tierKey', () => {
    expect(selectProviderCapacity(BASE, tiers, '4k')).toEqual({
      maxConcurrentRequests: 1,
      maxRequestsPerMinute: 15,
      requestTimeoutSeconds: 1800,
      cooldownSeconds: null,
      failureThreshold: null,
      tierKey: 'resolution:4k',
    });
  });

  it('inherits base fields the tier omits, without a base', () => {
    expect(selectProviderCapacity(undefined, tiers, '4k')).toEqual({
      maxConcurrentRequests: 1,
      maxRequestsPerMinute: 15,
      requestTimeoutSeconds: null,
      cooldownSeconds: null,
      failureThreshold: null,
      tierKey: 'resolution:4k',
    });
  });
});
