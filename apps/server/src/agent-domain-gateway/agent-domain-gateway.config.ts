import { createPublicKey, type KeyObject } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const requiredString = z.string().trim().min(1);
// The Agent Platform publishes two domain-signing keys: the Worker's, which
// executes business commands, and the admission API's, which exists only so the
// API can probe readiness. A JWKS that does not say which is which makes them
// interchangeable, so a compromised API replica could mint a tool-execution
// token — exactly what the API/Worker split is meant to prevent.
const capabilitySchema = z.enum(['readiness', 'runtime']);
const publicJwkSchema = z
  .object({
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    x: requiredString,
    kid: requiredString.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    alg: z.literal('EdDSA').optional(),
    use: z.literal('sig').optional(),
    d: z.never().optional(),
    fizzdragon_capability: capabilitySchema,
  })
  .passthrough();
const jwksSchema = z
  .object({
    keys: z.array(publicJwkSchema).min(1).max(16),
  })
  .strict();
const environmentSchema = z
  .object({
    AGENT_DOMAIN_JWKS_B64: z.string().min(1),
    AGENT_DOMAIN_JWT_ISSUER: requiredString,
    AGENT_DOMAIN_JWT_AUDIENCE: requiredString,
  })
  .passthrough();

export type AgentDomainCapability = z.infer<typeof capabilitySchema>;
export type AgentDomainVerificationKey = Readonly<{
  key: KeyObject;
  capability: AgentDomainCapability;
}>;

export type AgentDomainGatewayConfig = Readonly<{
  verificationKeys: ReadonlyMap<string, AgentDomainVerificationKey>;
  issuer: string;
  audience: string;
}>;

export function loadAgentDomainGatewayConfig(
  environment: NodeJS.ProcessEnv,
): AgentDomainGatewayConfig {
  const parsed = environmentSchema.parse(environment);
  const jwks = jwksSchema.parse(parseBase64Json(parsed.AGENT_DOMAIN_JWKS_B64));
  const verificationKeys = new Map<string, AgentDomainVerificationKey>();
  for (const jwk of jwks.keys) {
    if (verificationKeys.has(jwk.kid)) {
      throw new Error(
        `AGENT_DOMAIN_JWKS_B64 contains duplicate kid ${jwk.kid}`,
      );
    }
    let key: KeyObject;
    try {
      key = createPublicKey({
        format: 'jwk',
        key: jwk,
      });
    } catch {
      throw new Error(
        `AGENT_DOMAIN_JWKS_B64 key ${jwk.kid} is not a valid Ed25519 public JWK`,
      );
    }
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error(
        `AGENT_DOMAIN_JWKS_B64 key ${jwk.kid} is not an Ed25519 public key`,
      );
    }
    verificationKeys.set(
      jwk.kid,
      Object.freeze({ key, capability: jwk.fizzdragon_capability }),
    );
  }

  return Object.freeze({
    verificationKeys,
    issuer: parsed.AGENT_DOMAIN_JWT_ISSUER,
    audience: parsed.AGENT_DOMAIN_JWT_AUDIENCE,
  });
}

@Injectable()
export class AgentDomainGatewayConfigService {
  readonly values = loadAgentDomainGatewayConfig(process.env);
}

function parseBase64Json(value: string): unknown {
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length === 0 ||
    decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw new Error('AGENT_DOMAIN_JWKS_B64 must be canonical base64');
  }
  try {
    return JSON.parse(decoded.toString('utf8')) as unknown;
  } catch {
    throw new Error(
      'AGENT_DOMAIN_JWKS_B64 must encode a valid JWKS JSON object',
    );
  }
}
