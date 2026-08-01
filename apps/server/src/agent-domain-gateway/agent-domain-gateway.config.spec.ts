import { generateKeyPairSync, type JsonWebKey } from 'node:crypto';

import { loadAgentDomainGatewayConfig } from './agent-domain-gateway.config';

function environment(jwks: { keys: JsonWebKey[] }): NodeJS.ProcessEnv {
  return {
    AGENT_DOMAIN_JWKS_B64: Buffer.from(JSON.stringify(jwks)).toString('base64'),
    AGENT_DOMAIN_JWT_ISSUER: 'fizzdragon-agent-platform',
    AGENT_DOMAIN_JWT_AUDIENCE: 'fizzdragon-domain-gateway',
  };
}

function publicJwk(
  kid = 'domain-key-1',
  capability: 'readiness' | 'runtime' = 'runtime',
): JsonWebKey {
  const { publicKey } = generateKeyPairSync('ed25519');
  return {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'EdDSA',
    use: 'sig',
    fizzdragon_capability: capability,
  };
}

describe('Agent Domain Gateway configuration', () => {
  it('loads a rotation-safe Ed25519 public JWKS', () => {
    const config = loadAgentDomainGatewayConfig(
      environment({ keys: [publicJwk('current'), publicJwk('next')] }),
    );

    expect([...config.verificationKeys.keys()]).toEqual(['current', 'next']);
    expect(config.issuer).toBe('fizzdragon-agent-platform');
    expect(config.audience).toBe('fizzdragon-domain-gateway');
  });

  it('carries each key id its declared capability', () => {
    const config = loadAgentDomainGatewayConfig(
      environment({
        keys: [
          publicJwk('worker', 'runtime'),
          publicJwk('admission-api', 'readiness'),
        ],
      }),
    );

    expect(config.verificationKeys.get('worker')?.capability).toBe('runtime');
    expect(config.verificationKeys.get('admission-api')?.capability).toBe(
      'readiness',
    );
  });

  it('rejects a key that does not declare a capability', () => {
    const undeclared = publicJwk('undeclared');
    delete undeclared.fizzdragon_capability;

    expect(() =>
      loadAgentDomainGatewayConfig(environment({ keys: [undeclared] })),
    ).toThrow();
  });

  it('rejects duplicate key ids and private key material', () => {
    const duplicate = publicJwk('duplicate');
    expect(() =>
      loadAgentDomainGatewayConfig(
        environment({ keys: [duplicate, publicJwk('duplicate')] }),
      ),
    ).toThrow(/duplicate kid/);

    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() =>
      loadAgentDomainGatewayConfig(
        environment({
          keys: [
            {
              ...privateKey.export({ format: 'jwk' }),
              kid: 'private',
              alg: 'EdDSA',
              use: 'sig',
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('requires canonical base64', () => {
    const env = environment({ keys: [publicJwk()] });
    env.AGENT_DOMAIN_JWKS_B64 = `${env.AGENT_DOMAIN_JWKS_B64!}\n`;
    expect(() => loadAgentDomainGatewayConfig(env)).toThrow(
      /must be canonical base64/,
    );
  });
});
