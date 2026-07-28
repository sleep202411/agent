import { STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY } from '@repo/shared/studio-agent-transport';
import {
  StudioAgentAblyTokenIssuer,
  createStudioAgentAblyTokenSigner,
  type StudioAgentAblyTokenSigner,
} from './studio-agent.realtime';

/**
 * The credential policy, pinned.
 *
 * Everything here is about one property: the ROOT key stays in the process, and
 * what the browser gets instead can only ever address the one conversation its
 * holder proved access to. That property has no runtime symptom when it breaks
 * — a too-wide token works perfectly, for the attacker too — so it is asserted
 * rather than observed.
 */

const THREAD_ID = '019f8c10-0000-7000-8000-0000000000a0';
const OTHER_THREAD_ID = '019f8c10-0000-7000-8000-0000000000ff';
const CHANNEL = `studio-agent:thread:${THREAD_ID}`;
const ROOT_KEY = 'appId.keyId:c2VjcmV0LXZhbHVlLXRoYXQtaXMtbG9uZw==';
const TTL_MS = 120_000;

type SignerCall = {
  capability: Record<string, readonly string[]>;
  clientId: string;
  ttl: number;
};

function issuer() {
  const calls: SignerCall[] = [];
  const signer: StudioAgentAblyTokenSigner = {
    createTokenRequest: (params) => {
      calls.push(params);
      return Promise.resolve({
        keyName: 'appId.keyId',
        clientId: params.clientId,
        capability: JSON.stringify(params.capability),
        timestamp: 1_770_000_000_000,
        nonce: 'nonce-0123456789abcdef',
        mac: 'signature',
        ttl: params.ttl,
      });
    },
  };
  const config = { value: { ably: { apiKey: ROOT_KEY, tokenTtlMs: TTL_MS } } };
  return {
    calls,
    signer,
    subject: new StudioAgentAblyTokenIssuer(signer, config as never),
  };
}

describe('StudioAgentAblyTokenIssuer capability policy', () => {
  it('scopes the grant to exactly ONE channel — the caller thread and nothing else', async () => {
    const { subject, calls } = issuer();

    await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(Object.keys(calls[0].capability)).toEqual([CHANNEL]);
  });

  it('never mints a wildcard resource', async () => {
    // `{"*": [...]}` is what a static "subscribe-only" Ably key grants, and it
    // is the single most likely wrong turn here: it reads like a smaller
    // permission and is in fact every channel of every tenant, forever, with no
    // way to withdraw it from one user.
    const { subject, calls } = issuer();

    await subject.issueThreadToken(THREAD_ID, 'user-7');

    for (const resource of Object.keys(calls[0].capability)) {
      expect(resource).not.toContain('*');
      expect(resource).toBe(CHANNEL);
    }
  });

  it('grants subscribe, publish and history — and refuses to grow a fourth operation silently', async () => {
    // publish is not optional: the client transport puts the creator's own
    // input and cancel on the channel before any HTTP request is made. history
    // backs `view.loadOlder()`. Anything beyond these three — presence,
    // channel-metadata, push-subscribe — is a capability nobody asked for, so
    // the assertion is exact rather than "contains".
    const { subject, calls } = issuer();

    await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(calls[0].capability[CHANNEL]).toEqual([
      'subscribe',
      'publish',
      'history',
    ]);
    expect([...STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY]).toEqual([
      'subscribe',
      'publish',
      'history',
    ]);
  });

  it('cannot be talked into another thread channel by the caller', async () => {
    // The channel is derived from the thread id the controller already
    // authorized, so two callers on two threads get two disjoint grants. There
    // is no argument by which one can name the other's channel.
    const { subject, calls } = issuer();

    await subject.issueThreadToken(THREAD_ID, 'user-7');
    await subject.issueThreadToken(OTHER_THREAD_ID, 'user-7');

    expect(Object.keys(calls[0].capability)).toEqual([CHANNEL]);
    expect(Object.keys(calls[1].capability)).toEqual([
      `studio-agent:thread:${OTHER_THREAD_ID}`,
    ]);
  });

  it('sets the clientId server-side, from the authenticated actor', async () => {
    // Server-set so a participant cannot present themselves as somebody else on
    // the channel, and so per-client token revocation stays available without a
    // redesign.
    const { subject, calls } = issuer();

    const grant = await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(calls[0].clientId).toBe('user-7');
    expect(grant.tokenRequest.clientId).toBe('user-7');
  });

  it('carries the configured TTL, so a revoked grant expires rather than lingering', async () => {
    const { subject, calls } = issuer();

    const grant = await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(calls[0].ttl).toBe(TTL_MS);
    expect(grant.ttlMs).toBe(TTL_MS);
  });

  it('returns the channel it signed, so the client never has to guess it', async () => {
    // A client that rebuilt the channel name itself could drift from the name
    // inside the capability, and the failure would surface seconds later as an
    // opaque Ably attach error.
    const { subject } = issuer();

    const grant = await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(grant.channel).toBe(CHANNEL);
    expect(JSON.parse(grant.tokenRequest.capability)).toEqual({
      [CHANNEL]: ['subscribe', 'publish', 'history'],
    });
  });

  it('emits ONLY the seven signed-token-request fields — never the key', async () => {
    // The response is public. Mapping field by field (rather than spreading the
    // SDK's object) is what stops a future SDK version's new field from
    // reaching a browser because nobody decided it should.
    const { subject } = issuer();

    const grant = await subject.issueThreadToken(THREAD_ID, 'user-7');

    expect(Object.keys(grant.tokenRequest).sort()).toEqual([
      'capability',
      'clientId',
      'keyName',
      'mac',
      'nonce',
      'timestamp',
      'ttl',
    ]);
  });

  it('never lets the root key — or its secret half — into the grant', async () => {
    // The one assertion that would actually catch a catastrophe: serialize the
    // whole response and look for the credential in it.
    const { subject } = issuer();

    const grant = await subject.issueThreadToken(THREAD_ID, 'user-7');
    const serialized = JSON.stringify(grant);

    expect(serialized).not.toContain(ROOT_KEY);
    expect(serialized).not.toContain(ROOT_KEY.split(':')[1]);
    // The key NAME is public by design — Ably needs it to find the signing key —
    // so its presence is expected and its secret half's absence is the point.
    expect(grant.tokenRequest.keyName).toBe('appId.keyId');
  });

  /**
   * The signer's surface is ONE method, and that is load-bearing.
   *
   * It used to carry an empty `close()` "so the DI lifecycle is symmetric",
   * plus a Nest shutdown hook and a spy asserting the empty method was called.
   * `Ably.Rest` holds no connection, so all of that asserted that nothing
   * happened. A lifecycle member here has to mean a resource exists.
   */
  it('exposes token signing and nothing else — no lifecycle for a client that has none', () => {
    const { signer, subject } = issuer();

    expect(Object.keys(signer)).toEqual(['createTokenRequest']);
    expect(
      (subject as unknown as Record<string, unknown>).onApplicationShutdown,
    ).toBeUndefined();
  });
});

describe('createStudioAgentAblyTokenSigner', () => {
  it.each([
    ['empty', ''],
    ['a key NAME with no secret', 'appId.keyId'],
    ['a token rather than a key', 'appId.keyId_xVLyHw'],
    ['a secret with no key name', 'c2VjcmV0'],
  ])('refuses %s at the point of use', (_label, value) => {
    // The config schema already refuses these at boot. This is the second of
    // two locked doors, and it is the one standing where the credential is
    // actually used: a server that came up unable to mint would leave every
    // creator staring at an assistant that never connects.
    expect(() => createStudioAgentAblyTokenSigner(value)).toThrow(
      /ABLY_API_KEY/,
    );
  });

  it('accepts a complete key', () => {
    const signer = createStudioAgentAblyTokenSigner(ROOT_KEY);
    expect(typeof signer.createTokenRequest).toBe('function');
    expect(Object.keys(signer)).toEqual(['createTokenRequest']);
  });
});
