import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual, verify } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';

import { AgentDomainGatewayConfigService } from './agent-domain-gateway.config';

const MAX_AUTHORIZATION_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TOKEN_TTL_SECONDS = 120;
const CLOCK_TOLERANCE_SECONDS = 5;

const jwtHeaderSchema = z
  .object({
    alg: z.literal('EdDSA'),
    kid: z.string().trim().min(1).max(128),
    typ: z.literal('JWT'),
  })
  .strict();
const jwtClaimsSchema = z
  .object({
    iss: z.string().min(1),
    aud: z.string().min(1),
    sub: z.literal('fizzdragon-agent-platform'),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    jti: z.uuid(),
    request_method: z.enum(['GET', 'POST']),
    request_path: z.string().startsWith('/v1/agent/').max(512),
    body_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    tool_id: z.string().min(1).max(128).optional(),
    idempotency_key: z.string().min(1).max(256).optional(),
  })
  .strict();

export type AgentDomainRequestClaims = z.infer<typeof jwtClaimsSchema>;
export type AuthenticatedAgentDomainRequest = Request & {
  rawBody?: Buffer;
  agentDomainClaims?: AgentDomainRequestClaims;
};

@Injectable()
export class AgentDomainAuthGuard implements CanActivate {
  readonly #config: AgentDomainGatewayConfigService['values'];

  constructor(config: AgentDomainGatewayConfigService) {
    this.#config = config.values;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAgentDomainRequest>();
    const body = request.rawBody ?? Buffer.alloc(0);
    if (body.byteLength > MAX_REQUEST_BYTES) {
      throw new PayloadTooLargeException({
        code: 'AGENT_DOMAIN_REQUEST_TOO_LARGE',
        message: 'Agent Domain Gateway requests are limited to 1 MiB.',
      });
    }

    const authorization = request.headers.authorization ?? '';
    if (
      Buffer.byteLength(authorization) > MAX_AUTHORIZATION_BYTES ||
      !authorization.startsWith('Bearer ')
    ) {
      throw unauthorized();
    }
    const token = authorization.slice('Bearer '.length);
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw unauthorized();
    }

    let header: z.infer<typeof jwtHeaderSchema>;
    let claims: AgentDomainRequestClaims;
    try {
      header = jwtHeaderSchema.parse(decodeJwtPart(parts[0]));
      claims = jwtClaimsSchema.parse(decodeJwtPart(parts[1]));
    } catch {
      throw unauthorized();
    }
    const credential = this.#config.verificationKeys.get(header.kid);
    if (
      !credential ||
      !verify(
        null,
        Buffer.from(`${parts[0]}.${parts[1]}`),
        credential.key,
        Buffer.from(parts[2], 'base64url'),
      )
    ) {
      throw unauthorized();
    }

    const now = Math.floor(Date.now() / 1_000);
    const requestHash = createHash('sha256').update(body).digest();
    const claimHash = Buffer.from(claims.body_sha256, 'hex');
    if (
      claims.iss !== this.#config.issuer ||
      claims.aud !== this.#config.audience ||
      claims.exp <= now - CLOCK_TOLERANCE_SECONDS ||
      claims.iat > now + CLOCK_TOLERANCE_SECONDS ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > MAX_TOKEN_TTL_SECONDS ||
      claims.request_method !== request.method ||
      claims.request_path !== request.path ||
      claimHash.length !== requestHash.length ||
      !timingSafeEqual(claimHash, requestHash)
    ) {
      throw unauthorized();
    }

    const idempotencyHeader = singleHeader(request.headers['idempotency-key']);
    const isToolExecution =
      request.method === 'POST' &&
      /^\/v1\/agent\/tools\/[^/]+\/execute$/u.test(request.path);
    const isAttachmentResolution =
      request.method === 'POST' &&
      request.path === '/v1/agent/attachments/resolve';
    const isInvocationLifecycle =
      request.method === 'POST' &&
      /^\/v1\/agent\/invocations\/[0-9a-f-]+\/lifecycle$/u.test(request.path);
    const isDocumentAnalysis =
      request.method === 'POST' &&
      /^\/v1\/agent\/document-analysis\/[0-9a-f-]+\/(?:claim|sections\/chunk-[0-9]{6}\/read|artifacts(?:\/context)?|complete|fail)$/u.test(
        request.path,
      );
    const isReadiness =
      request.method === 'GET' && request.path === '/v1/agent/health/ready';
    const validRouteBinding = isToolExecution
      ? !!claims.tool_id &&
        !!claims.idempotency_key &&
        claims.tool_id === request.params.toolId &&
        claims.idempotency_key === idempotencyHeader
      : isAttachmentResolution ||
          isInvocationLifecycle ||
          isDocumentAnalysis ||
          isReadiness
        ? claims.tool_id === undefined &&
          claims.idempotency_key === undefined &&
          idempotencyHeader === ''
        : false;
    if (!validRouteBinding) {
      throw unauthorized();
    }
    // Readiness is the only route a key may reach on its identity alone. Every
    // other route mutates or reads product state, so it is reserved for the
    // Worker's kid: a compromised admission API holds a domain key too, and its
    // signature must not buy it a business command in anyone's name.
    if (!isReadiness && credential.capability !== 'runtime') {
      throw unauthorized();
    }

    request.agentDomainClaims = claims;
    return true;
  }
}

function decodeJwtPart(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
}

function singleHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'AGENT_DOMAIN_UNAUTHORIZED',
    message: 'Invalid or missing Agent Platform workload credential.',
  });
}
