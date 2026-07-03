import { CharacterEnrollmentService } from './character-enrollment.service';
import {
  consentTextSha256,
  decryptEnrollmentToken,
  encryptEnrollmentToken,
  REAL_PERSON_CONSENT_VERSION,
} from './consent';

const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

function makeService(
  overrides: {
    realPersonEnabled?: boolean;
    acrExpiresAt?: Date | null;
    region?: string;
  } = {},
) {
  process.env.NEXT_PUBLIC_SITE_REGION = overrides.region ?? 'global';
  const featureFlags = {
    config: {
      enabled: true,
      realPersonEnabled: overrides.realPersonEnabled ?? true,
    },
  };
  const assetsConfig = {
    config: {
      projectName: 'default',
      enrollmentTokenKey: TOKEN_KEY,
      acrExpiresAt: overrides.acrExpiresAt ?? null,
    },
    enrollmentHardBlocked: () => {
      const expires = overrides.acrExpiresAt;
      if (!expires) return false;
      return expires.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
    },
  };
  return new CharacterEnrollmentService(
    {} as never,
    featureFlags as never,
    assetsConfig as never,
    {} as never,
    {} as never,
    {} as never, // CharacterGrantService — unused by the tested methods
  );
}

const VALID_CONSENT = {
  version: REAL_PERSON_CONSENT_VERSION,
  adultAttested: true as const,
};

describe('requireRealPersonCreateAllowed (design §2.1a-c gates)', () => {
  it('returns ledger evidence with the canonical text hash on success', () => {
    const record = makeService().requireRealPersonCreateAllowed({
      consent: VALID_CONSENT,
      context: { ip: '1.2.3.4', userAgent: 'jest', locale: 'en-US' },
    });
    expect(record.consentVersion).toBe(REAL_PERSON_CONSENT_VERSION);
    expect(record.evidence).toMatchObject({
      consentTextSha256: consentTextSha256(),
      ip: '1.2.3.4',
      ageGateOutcome: 'adult_attested',
    });
    // Ledger stores hashes/metadata only — never the raw consent text.
    expect(JSON.stringify(record.evidence)).not.toContain('FizzDragon Real');
  });

  it('501s while the feature flag is off', () => {
    expect(() =>
      makeService({ realPersonEnabled: false }).requireRealPersonCreateAllowed({
        consent: VALID_CONSENT,
        context: {},
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'REAL_PERSON_NOT_AVAILABLE',
        }),
      }),
    );
  });

  it('403s on the CN cell (PIPL cross-border precondition, §0)', () => {
    expect(() =>
      makeService({ region: 'cn' }).requireRealPersonCreateAllowed({
        consent: VALID_CONSENT,
        context: {},
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'CN_REAL_PERSON_UNAVAILABLE',
        }),
      }),
    );
  });

  it('blocks enrollment inside the ACR T-7d window (§6.1)', () => {
    expect(() =>
      makeService({
        acrExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      }).requireRealPersonCreateAllowed({
        consent: VALID_CONSENT,
        context: {},
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ACR_ENROLLMENT_PAUSED' }),
      }),
    );
  });

  it('rejects a stale consent version and a missing adult attestation', () => {
    for (const consent of [
      { version: 'realperson-consent-v0-old', adultAttested: true as const },
      undefined,
    ]) {
      expect(() =>
        makeService().requireRealPersonCreateAllowed({ consent, context: {} }),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'CONSENT_REQUIRED' }),
        }),
      );
    }
  });
});

describe('enrollment token envelope (design §1 bytedTokenEnc)', () => {
  it('round-trips and never stores the token in the clear', () => {
    const token = 'byted-token-abc-123';
    const sealed = encryptEnrollmentToken(token, TOKEN_KEY);
    expect(sealed).not.toContain(token);
    expect(sealed.startsWith('v1$')).toBe(true);
    expect(decryptEnrollmentToken(sealed, TOKEN_KEY)).toBe(token);
  });

  it('fails closed on a tampered envelope', () => {
    const sealed = encryptEnrollmentToken('byted-token', TOKEN_KEY);
    const [v, iv, payload, tag] = sealed.split('$');
    const tampered = [v, iv, payload.slice(0, -2) + 'AA', tag].join('$');
    expect(() => decryptEnrollmentToken(tampered, TOKEN_KEY)).toThrow();
  });

  it('rejects a wrong-size key loudly', () => {
    expect(() =>
      encryptEnrollmentToken('t', Buffer.alloc(16, 1).toString('base64')),
    ).toThrow(/32 bytes/);
  });
});
