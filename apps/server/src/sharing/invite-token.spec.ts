import { generateInviteToken, hashInviteToken } from './invite-token';

describe('invite-token', () => {
  it('generates a url-safe token + its sha256 hash', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(tokenHash).toBe(hashInviteToken(token));
  });

  it('is deterministic + trims, so lookup matches creation', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(hashInviteToken(` ${token} `)).toBe(tokenHash);
  });

  it('produces distinct tokens + hashes across calls', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('hash fits the tokenHash column (≤128 chars)', () => {
    expect(hashInviteToken('anything').length).toBeLessThanOrEqual(128);
  });
});
