import { MastraAuthProvider, getWebRequest, type MastraAuthRequest } from "@mastra/core/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

import type { RuntimeConfig } from "../config/env.js";
import {
  agentSecurityPartition,
  gatewayClaimsSchema,
  type GatewayClaims,
} from "../context/agent-context.js";

const LOCAL_ISSUER = "fizzdragon-agent-local";
const LOCAL_AUDIENCE = "fizzdragon-agent-platform";
const MAX_GATEWAY_TOKEN_TTL_SECONDS = 15 * 60;
const PRODUCT_AGENT_POST_ROUTES = new Set([
  "/api/v1/invocations",
  "/api/v1/cancellations",
  "/api/v1/history",
]);

export class GatewayAuthProvider extends MastraAuthProvider<GatewayClaims> {
  readonly #auth: RuntimeConfig["auth"];
  readonly #remoteJwks?: JWTVerifyGetKey;

  constructor(config: RuntimeConfig["auth"]) {
    super({
      protected: [/^\/api(?:\/|$)/, /^\/__mastra(?:\/|$)/],
      public: [
        ["/api/v1/health/live", "GET"],
        ["/api/v1/health/ready", "GET"],
      ],
      mapUserToResourceId: (user) =>
        `${agentSecurityPartition(user.agent_context)}:${user.agent_context.actorId}`,
    });
    this.#auth = config;
    if (config.mode === "jwks") {
      this.#remoteJwks = createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
        timeoutDuration: 5_000,
      });
    }
  }

  override async authenticateToken(token: string): Promise<GatewayClaims> {
    const { payload } =
      this.#auth.mode === "jwks"
        ? await jwtVerify(token, requiredJwks(this.#remoteJwks), {
            issuer: this.#auth.issuer,
            audience: this.#auth.audience,
            algorithms: ["EdDSA"],
            clockTolerance: 5,
          })
        : await jwtVerify(token, new TextEncoder().encode(this.#auth.secret), {
            issuer: LOCAL_ISSUER,
            audience: LOCAL_AUDIENCE,
            algorithms: ["HS256"],
            clockTolerance: 5,
          });

    return parseClaims(payload);
  }

  override authorizeUser(_user: GatewayClaims, request: MastraAuthRequest): boolean {
    const webRequest = getWebRequest(request);
    if (!webRequest) return false;
    const { pathname } = new URL(webRequest.url);

    // Product execution must enter through the durable invocation boundary.
    // Mastra's built-in direct agent execution routes are intentionally denied.
    return webRequest.method === "POST" && PRODUCT_AGENT_POST_ROUTES.has(pathname);
  }
}

function requiredJwks(value: JWTVerifyGetKey | undefined): JWTVerifyGetKey {
  if (!value) throw new Error("JWKS verifier was not initialized");
  return value;
}

function parseClaims(payload: JWTPayload): GatewayClaims {
  const claims = gatewayClaimsSchema.parse(payload);
  if (claims.exp - claims.iat > MAX_GATEWAY_TOKEN_TTL_SECONDS) {
    throw new Error(`Gateway token lifetime exceeds ${MAX_GATEWAY_TOKEN_TTL_SECONDS} seconds`);
  }
  return claims;
}

export const localJwtParameters = Object.freeze({
  issuer: LOCAL_ISSUER,
  audience: LOCAL_AUDIENCE,
});
