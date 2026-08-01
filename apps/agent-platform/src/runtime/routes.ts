import { Invocation } from "@ably/ai-transport";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";

import type { RuntimeConfig } from "../config/env.js";
import {
  agentMemoryScope,
  gatewayClaimsSchema,
  type GatewayClaims,
} from "../context/agent-context.js";
import { InvalidAgentHistoryCursorError, type AgentMemory } from "../memory/agent-memory.js";
import { agentCancellationCommandSchema, agentInvocationCommandSchema } from "./contracts.js";
import type { ReadinessChecker } from "./readiness.js";
import {
  AgentInvocationQueueFullError,
  AgentInvocationSequenceConflictError,
  cancelAgentInvocation,
  enqueueAgentInvocation,
} from "./temporal-client.js";

const invocationDataSchema = z
  .object({
    inputEventId: z.string().min(1).max(256),
    sessionName: z.string().min(1).max(512),
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    provisionalRunId: z.string().uuid(),
  })
  .strict();

const cancellationDataSchema = z
  .object({
    invocationId: z.string().uuid(),
    sessionName: z.string().min(1).max(512),
  })
  .strict();

const historyDataSchema = z
  .object({
    sessionName: z.string().min(1).max(128),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

type JsonBodyReader = Readonly<{
  json: () => Promise<unknown>;
}>;

export async function parseInvocationData(request: JsonBodyReader) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Route all malformed JSON through the same structured 400 response as
    // every other request-contract violation.
    body = undefined;
  }
  return invocationDataSchema.parse(body);
}

export async function parseCancellationData(request: JsonBodyReader) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  return cancellationDataSchema.parse(body);
}

export function createRuntimeRoutes(input: {
  config: RuntimeConfig;
  readiness: ReadinessChecker;
  agentMemory: Pick<AgentMemory, "listUiMessages">;
}) {
  const invocationRoute = registerApiRoute("/api/v1/invocations", {
    method: "POST",
    requiresAuth: true,
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const claims = gatewayClaimsSchema.parse(requestContext.get<"user", GatewayClaims>("user"));
      const signedContext = claims.agent_context;
      let invocation: Invocation;
      let invocationRequest: z.infer<typeof invocationDataSchema>;

      try {
        invocationRequest = await parseInvocationData(c.req);
        invocation = Invocation.fromJSON({
          inputEventId: invocationRequest.inputEventId,
          sessionName: invocationRequest.sessionName,
        });
      } catch {
        return jsonResponse(
          {
            code: "AGENT_INVOCATION_INVALID",
            message: "The invocation request does not satisfy agent-invocation/v1.",
          },
          { status: 400 }
        );
      }

      if (invocation.sessionName !== signedContext.sessionName) {
        return jsonResponse(
          {
            code: "AGENT_SESSION_SCOPE_MISMATCH",
            message: "The requested session is outside the signed agent scope.",
          },
          { status: 403 }
        );
      }

      const workflowInput = agentInvocationCommandSchema.parse({
        schemaVersion: "agent-invocation-command/v1",
        invocation: invocation.toJSON(),
        invocationId: invocationRequest.invocationId,
        attemptId: invocationRequest.attemptId,
        attemptOrdinal: invocationRequest.attemptOrdinal,
        provisionalRunId: invocationRequest.provisionalRunId,
        maxModelSteps: input.config.maxModelSteps,
        context: signedContext,
      });

      let workflowId: string;
      try {
        workflowId = await enqueueAgentInvocation(input.config, workflowInput);
      } catch (error) {
        if (error instanceof AgentInvocationQueueFullError) {
          return jsonResponse(
            {
              code: error.code,
              message: "This Agent conversation has reached its bounded pending-turn limit.",
              retryable: true,
            },
            {
              status: 429,
              headers: { "retry-after": "1" },
            }
          );
        }
        if (error instanceof AgentInvocationSequenceConflictError) {
          return jsonResponse(
            {
              code: error.code,
              message: "The invocation attempt is not the next valid durable continuation.",
              retryable: false,
            },
            { status: 409 }
          );
        }
        return jsonResponse(
          {
            code: "AGENT_RUNTIME_UNAVAILABLE",
            message: "The durable agent runtime is temporarily unavailable.",
          },
          {
            status: 503,
            headers: { "retry-after": "1" },
          }
        );
      }

      return jsonResponse(
        {
          schemaVersion: "agent-invocation-accepted/v1",
          invocationId: invocationRequest.invocationId,
          attemptId: invocationRequest.attemptId,
          attemptOrdinal: invocationRequest.attemptOrdinal,
          workflowId,
        },
        {
          status: 202,
        }
      );
    },
  });

  const cancellationRoute = registerApiRoute("/api/v1/cancellations", {
    method: "POST",
    requiresAuth: true,
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const claims = gatewayClaimsSchema.parse(requestContext.get<"user", GatewayClaims>("user"));
      const signedContext = claims.agent_context;
      let cancellation: z.infer<typeof cancellationDataSchema>;

      try {
        cancellation = await parseCancellationData(c.req);
      } catch {
        return jsonResponse(
          {
            code: "AGENT_CANCELLATION_INVALID",
            message: "The cancellation request does not satisfy agent-cancellation/v1.",
          },
          { status: 400 }
        );
      }

      if (cancellation.sessionName !== signedContext.sessionName) {
        return jsonResponse(
          {
            code: "AGENT_SESSION_SCOPE_MISMATCH",
            message: "The requested session is outside the signed agent scope.",
          },
          { status: 403 }
        );
      }

      const command = agentCancellationCommandSchema.parse({
        schemaVersion: "agent-cancellation-command/v1",
        sessionName: cancellation.sessionName,
        invocationId: cancellation.invocationId,
      });

      try {
        return jsonResponse(await cancelAgentInvocation(input.config, command));
      } catch {
        return jsonResponse(
          {
            code: "AGENT_RUNTIME_UNAVAILABLE",
            message: "The durable agent runtime is temporarily unavailable.",
          },
          {
            status: 503,
            headers: { "retry-after": "1" },
          }
        );
      }
    },
  });

  const historyRoute = registerApiRoute("/api/v1/history", {
    method: "POST",
    requiresAuth: true,
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const claims = gatewayClaimsSchema.parse(requestContext.get<"user", GatewayClaims>("user"));
      const signedContext = claims.agent_context;
      let request: z.infer<typeof historyDataSchema>;
      try {
        request = historyDataSchema.parse(await c.req.json());
      } catch {
        return jsonResponse(
          {
            code: "AGENT_HISTORY_REQUEST_INVALID",
            message: "The history request does not satisfy agent-history/v1.",
          },
          { status: 400 }
        );
      }
      if (request.sessionName !== signedContext.sessionName) {
        return jsonResponse(
          {
            code: "AGENT_SESSION_SCOPE_MISMATCH",
            message: "The requested session is outside the signed agent scope.",
          },
          { status: 403 }
        );
      }

      try {
        const page = await input.agentMemory.listUiMessages(
          agentMemoryScope(signedContext),
          request
        );
        return jsonResponse({
          schemaVersion: "agent-history-page/v1",
          ...page,
        });
      } catch (error) {
        if (error instanceof InvalidAgentHistoryCursorError) {
          return jsonResponse(
            {
              code: "AGENT_HISTORY_CURSOR_INVALID",
              message: "The Agent message history cursor is invalid.",
            },
            { status: 400 }
          );
        }
        return jsonResponse(
          {
            code: "AGENT_MEMORY_UNAVAILABLE",
            message: "Agent message history is temporarily unavailable.",
          },
          {
            status: 503,
            headers: { "retry-after": "1" },
          }
        );
      }
    },
  });

  const liveRoute = registerApiRoute("/api/v1/health/live", {
    method: "GET",
    requiresAuth: false,
    handler: () =>
      jsonResponse({
        status: "ok",
        service: "fizzdragon-agent-platform",
      }),
  });

  const readyRoute = registerApiRoute("/api/v1/health/ready", {
    method: "GET",
    requiresAuth: false,
    handler: async () => {
      const readiness = await input.readiness.check();
      return jsonResponse(
        {
          status: readiness.ready ? "ready" : "not-ready",
          degraded: readiness.degraded,
          dependencies: readiness.dependencies,
          checkedAt: readiness.checkedAt,
        },
        {
          status: readiness.ready ? 200 : 503,
        }
      );
    },
  });

  const notFoundRoute = registerApiRoute("*", {
    method: "ALL",
    requiresAuth: false,
    handler: () =>
      jsonResponse(
        {
          code: "AGENT_ROUTE_NOT_FOUND",
          message: "The requested Agent Platform route does not exist.",
        },
        { status: 404 }
      ),
  });

  return [
    invocationRoute,
    cancellationRoute,
    historyRoute,
    liveRoute,
    readyRoute,
    notFoundRoute,
  ] as const;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(body, { ...init, headers });
}
