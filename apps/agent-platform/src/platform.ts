import type { Mastra } from "@mastra/core/mastra";
import { ZodError } from "zod";

import { GatewayAuthProvider } from "./auth/gateway-auth.js";
import { loadRuntimeConfig } from "./config/env.js";
import { createAgentInfrastructure } from "./core-platform.js";
import { ReadinessChecker } from "./runtime/readiness.js";
import { createRuntimeRoutes } from "./runtime/routes.js";

export function createAgentPlatformComponents() {
  const config = loadRuntimeConfig();
  const infrastructure = createAgentInfrastructure(config);
  const { domainGateway } = infrastructure;
  const readiness = new ReadinessChecker({
    config,
    domainGateway,
    assertAgentMemoryReady: infrastructure.agentMemory.assertReady,
  });
  const auth = new GatewayAuthProvider(config.auth);
  const mastraOptions: ConstructorParameters<typeof Mastra>[0] = {
    ...infrastructure.infrastructureMastraOptions,
    server: {
      host: "0.0.0.0",
      port: config.port,
      // Custom product routes live under /api. Mastra's built-in API is moved
      // to a separate, authenticated prefix and is denied by authorization.
      apiPrefix: "/__mastra",
      timeout: 30_000,
      bodySizeLimit: 64 * 1024,
      cors: false,
      middleware: async (c, next) => {
        await next();
        c.res.headers.set("cache-control", "no-store");
        c.res.headers.set("x-content-type-options", "nosniff");
      },
      auth,
      apiRoutes: [
        ...createRuntimeRoutes({
          config,
          readiness,
          agentMemory: infrastructure.agentMemory,
        }),
      ],
      build: {
        apiReqLogs: {
          enabled: true,
          level: "info",
          excludePaths: ["/api/v1/health/live", "/api/v1/health/ready"],
          includeHeaders: false,
          includeQueryParams: false,
        },
        openAPIDocs: true,
        swaggerUI: false,
      },
      onError: (error) => {
        if (error instanceof ZodError) {
          return Response.json(
            {
              code: "AGENT_REQUEST_INVALID",
              message: "The agent request does not satisfy the API contract.",
              details: error.issues.map((issue) => ({
                path: issue.path,
                message: issue.message,
              })),
            },
            { status: 400 }
          );
        }
        return Response.json(
          {
            code: "AGENT_REQUEST_FAILED",
            message: "The agent request could not be scheduled. Please retry.",
          },
          { status: 503 }
        );
      },
    },
  };

  return Object.freeze({
    ...infrastructure,
    config,
    mastraOptions,
    readiness,
  });
}

export type AgentPlatformComponents = ReturnType<typeof createAgentPlatformComponents>;
