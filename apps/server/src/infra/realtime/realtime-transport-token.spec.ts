import {
  signRealtimeToken,
  verifyRealtimeToken,
} from './realtime-transport-token';

const SECRET = 'test-secret-please-change';
const NOW = 1_000_000;

describe('realtime-transport-token', () => {
  it('round-trips a valid token', () => {
    const token = signRealtimeToken(SECRET, {
      userId: 'u1',
      groups: ['assets-user:u1', 'assets-workspace:w1'],
      exp: NOW + 60_000,
    });
    const payload = verifyRealtimeToken(SECRET, token, NOW);
    expect(payload).toEqual({
      userId: 'u1',
      groups: ['assets-user:u1', 'assets-workspace:w1'],
      exp: NOW + 60_000,
    });
  });

  it('rejects an expired token', () => {
    const token = signRealtimeToken(SECRET, {
      userId: 'u1',
      groups: ['g'],
      exp: NOW,
    });
    expect(verifyRealtimeToken(SECRET, token, NOW)).toBeNull();
    expect(verifyRealtimeToken(SECRET, token, NOW - 1)).not.toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signRealtimeToken('other-secret', {
      userId: 'u1',
      groups: ['g'],
      exp: NOW + 60_000,
    });
    expect(verifyRealtimeToken(SECRET, token, NOW)).toBeNull();
  });

  it('rejects tampered payloads', () => {
    const token = signRealtimeToken(SECRET, {
      userId: 'u1',
      groups: ['assets-user:u1'],
      exp: NOW + 60_000,
    });
    const [, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ userId: 'attacker', groups: ['*'], exp: NOW + 60_000 }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyRealtimeToken(SECRET, `${forgedBody}.${sig}`, NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyRealtimeToken(SECRET, '', NOW)).toBeNull();
    expect(verifyRealtimeToken(SECRET, 'no-dot', NOW)).toBeNull();
    expect(verifyRealtimeToken(SECRET, '.sig', NOW)).toBeNull();
    expect(verifyRealtimeToken(SECRET, 'body.', NOW)).toBeNull();
    expect(verifyRealtimeToken(SECRET, 'not.base64!!', NOW)).toBeNull();
  });
});
