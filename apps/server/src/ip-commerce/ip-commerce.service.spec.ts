import { ConflictException } from '@nestjs/common';
import { IpAccessMode, IpPublicationStatus } from '@prisma/client';
import {
  assertIpPurchaserAllowed,
  episodeStatusForIpPublication,
  isEntitlementActiveForAccess,
  resolveEpisodeAccessState,
  resolveIpAccessState,
  resolveIpEntitlementWindow,
} from './ip-commerce.service';

describe('IP commerce purchase guards', () => {
  it('rejects creator self-purchases', () => {
    expect(() =>
      assertIpPurchaserAllowed({
        buyerUserId: 'creator-1',
        creatorUserId: 'creator-1',
      }),
    ).toThrow(ConflictException);
  });

  it('allows purchases by a different user', () => {
    expect(() =>
      assertIpPurchaserAllowed({
        buyerUserId: 'viewer-1',
        creatorUserId: 'creator-1',
      }),
    ).not.toThrow();
  });

  it('rejects purchases by an editor with IP edit access', () => {
    expect(() =>
      assertIpPurchaserAllowed({
        buyerUserId: 'editor-1',
        creatorUserId: 'creator-1',
        hasEditAccess: true,
      }),
    ).toThrow(ConflictException);
  });
});

describe('episodeStatusForIpPublication', () => {
  it('promotes draft episodes when the IP is published or scheduled', () => {
    expect(episodeStatusForIpPublication(IpPublicationStatus.published)).toBe(
      IpPublicationStatus.published,
    );
    expect(episodeStatusForIpPublication(IpPublicationStatus.scheduled)).toBe(
      IpPublicationStatus.scheduled,
    );
    expect(episodeStatusForIpPublication(IpPublicationStatus.approved)).toBe(
      IpPublicationStatus.approved,
    );
  });

  it('does not promote episodes for non-live admin publication states', () => {
    expect(episodeStatusForIpPublication(IpPublicationStatus.draft)).toBeNull();
    expect(
      episodeStatusForIpPublication(IpPublicationStatus.submitted),
    ).toBeNull();
    expect(
      episodeStatusForIpPublication(IpPublicationStatus.in_review),
    ).toBeNull();
    expect(
      episodeStatusForIpPublication(IpPublicationStatus.changes_requested),
    ).toBeNull();
    expect(
      episodeStatusForIpPublication(IpPublicationStatus.hidden),
    ).toBeNull();
    expect(
      episodeStatusForIpPublication(IpPublicationStatus.suspended),
    ).toBeNull();
  });
});

describe('IP commerce management access', () => {
  it('treats an IP manager as owning their IP even without an entitlement', () => {
    expect(
      resolveIpAccessState({
        hasManagementAccess: true,
        hasIpEntitlement: false,
        hasPendingIpEntitlement: false,
        accessMode: IpAccessMode.points_priced,
        isMember: false,
        hasIpPrice: true,
      }),
    ).toEqual({ owned: true, access: 'owned' });
  });

  it('treats an IP manager as owning paid episodes even without an entitlement', () => {
    expect(
      resolveEpisodeAccessState({
        hasManagementAccess: true,
        hasIpEntitlement: false,
        hasEpisodeEntitlement: false,
        hasPendingIpEntitlement: false,
        hasPendingEpisodeEntitlement: false,
        isFreePreview: false,
        accessMode: IpAccessMode.points_priced,
        isMember: false,
        hasEpisodePrice: true,
        hasIpPrice: true,
      }),
    ).toEqual({ owned: true, access: 'owned_ip' });
  });

  it('treats free-watch certification as owning paid IP content', () => {
    expect(
      resolveIpAccessState({
        hasManagementAccess: false,
        hasFreeWatchPass: true,
        hasIpEntitlement: false,
        hasPendingIpEntitlement: false,
        accessMode: IpAccessMode.points_priced,
        isMember: false,
        hasIpPrice: true,
      }),
    ).toEqual({ owned: true, access: 'owned' });
  });

  it('treats free-watch certification as owning paid episodes', () => {
    expect(
      resolveEpisodeAccessState({
        hasManagementAccess: false,
        hasFreeWatchPass: true,
        hasIpEntitlement: false,
        hasEpisodeEntitlement: false,
        hasPendingIpEntitlement: false,
        hasPendingEpisodeEntitlement: false,
        isFreePreview: false,
        accessMode: IpAccessMode.points_priced,
        isMember: false,
        hasEpisodePrice: true,
        hasIpPrice: true,
      }),
    ).toEqual({ owned: true, access: 'owned_ip' });
  });

  it('keeps a paid episode locked for a non-manager without entitlement', () => {
    expect(
      resolveEpisodeAccessState({
        hasManagementAccess: false,
        hasIpEntitlement: false,
        hasEpisodeEntitlement: false,
        hasPendingIpEntitlement: false,
        hasPendingEpisodeEntitlement: false,
        isFreePreview: false,
        accessMode: IpAccessMode.points_priced,
        isMember: false,
        hasEpisodePrice: true,
        hasIpPrice: false,
      }),
    ).toEqual({ owned: false, access: 'locked' });
  });
});

describe('IP commerce entitlement windows', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');

  it('starts access immediately when no future unlock is configured', () => {
    expect(resolveIpEntitlementWindow({ unlocksAt: null }, now)).toEqual({
      startsAt: now,
      endsAt: null,
    });
  });

  it('starts access at the future unlock time for presales', () => {
    const unlocksAt = new Date('2026-06-01T12:00:00.000Z');

    expect(resolveIpEntitlementWindow({ unlocksAt }, now)).toEqual({
      startsAt: unlocksAt,
      endsAt: null,
    });
  });

  it('does not grant watch access before a future start time', () => {
    expect(
      isEntitlementActiveForAccess(
        { startsAt: new Date('2026-06-01T12:00:00.000Z'), endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('grants watch access during the entitlement window', () => {
    expect(
      isEntitlementActiveForAccess(
        {
          startsAt: new Date('2026-05-30T12:00:00.000Z'),
          endsAt: new Date('2026-06-01T12:00:00.000Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('does not grant watch access after the entitlement has expired', () => {
    expect(
      isEntitlementActiveForAccess(
        {
          startsAt: new Date('2026-05-30T12:00:00.000Z'),
          endsAt: new Date('2026-05-31T11:59:59.000Z'),
        },
        now,
      ),
    ).toBe(false);
  });
});
