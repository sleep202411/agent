import { crewInviteLinkState } from './invite-links.service';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function link(over: Partial<Parameters<typeof crewInviteLinkState>[0]> = {}) {
  return {
    revokedAt: null,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    ...over,
  };
}

describe('crewInviteLinkState', () => {
  it('treats an unbounded link as active — no expiry and no cap is a real choice', () => {
    expect(crewInviteLinkState(link(), NOW)).toBe('active');
  });

  it('reports revoked ahead of every other reason', () => {
    // A revoked link that is also expired and exhausted must still read as
    // revoked: that is the state the crew acted on and expects to see.
    expect(
      crewInviteLinkState(
        link({
          revokedAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2026-08-02T00:00:00.000Z'),
          maxUses: 1,
          useCount: 5,
        }),
        NOW,
      ),
    ).toBe('revoked');
  });

  it('expires exactly at the boundary, not a tick later', () => {
    expect(crewInviteLinkState(link({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(
      crewInviteLinkState(
        link({ expiresAt: new Date(NOW.getTime() + 1) }),
        NOW,
      ),
    ).toBe('active');
  });

  it('exhausts on reaching the cap, and never on an unlimited link', () => {
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 2 }), NOW)).toBe(
      'active',
    );
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 3 }), NOW)).toBe(
      'exhausted',
    );
    // A cap that was somehow overshot still reads as closed, not active.
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 9 }), NOW)).toBe(
      'exhausted',
    );
    expect(
      crewInviteLinkState(link({ maxUses: null, useCount: 9_999 }), NOW),
    ).toBe('active');
  });
});
