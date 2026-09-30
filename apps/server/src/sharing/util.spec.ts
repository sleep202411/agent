import { effectiveInviteStatus, isUniqueViolation } from './util';

describe('isUniqueViolation', () => {
  it('detects Prisma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
  });
  it('ignores other errors / non-objects', () => {
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('P2002')).toBe(false);
  });
});

describe('effectiveInviteStatus (lazy expiry)', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const future = new Date('2026-06-22T12:00:00Z');
  const past = new Date('2026-06-08T12:00:00Z');

  it('keeps a pending link pending before expiry', () => {
    expect(
      effectiveInviteStatus({ status: 'pending', expiresAt: future }, now),
    ).toBe('pending');
  });

  it('reports a pending link past expiry as expired', () => {
    expect(
      effectiveInviteStatus({ status: 'pending', expiresAt: past }, now),
    ).toBe('expired');
  });

  it('treats the exact expiry instant as expired (inclusive boundary)', () => {
    expect(
      effectiveInviteStatus({ status: 'pending', expiresAt: now }, now),
    ).toBe('expired');
  });

  it('treats null expiry as permanent (never expires)', () => {
    expect(
      effectiveInviteStatus({ status: 'pending', expiresAt: null }, now),
    ).toBe('pending');
  });

  it('passes terminal statuses through unchanged, even past expiry', () => {
    expect(
      effectiveInviteStatus({ status: 'revoked', expiresAt: past }, now),
    ).toBe('revoked');
    expect(
      effectiveInviteStatus({ status: 'accepted', expiresAt: future }, now),
    ).toBe('accepted');
    expect(
      effectiveInviteStatus({ status: 'expired', expiresAt: past }, now),
    ).toBe('expired');
  });
});
