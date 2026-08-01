import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import { z } from "zod";

import {
  INFERENCE_TIER_KEY,
  inferenceTierSchema,
  type InferenceTier,
} from "../models/inference-policy.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const causalMessageIdsSchema = z.array(z.string().min(1).max(512)).max(256);
const causalAttachmentIdsSchema = z.array(z.uuid()).max(32);

export const CAUSAL_MESSAGE_IDS_KEY = "causalMessageIds" as const;
export const CAUSAL_ATTACHMENT_IDS_KEY = "causalAttachmentIds" as const;

export const agentSurfaceSchema = z.enum(["story-studio", "crew-management"]);

export const storyAgentScopeSchema = z
  .object({
    kind: z.literal("story-project"),
    workspaceId: identifierSchema,
    projectId: identifierSchema,
  })
  .strict();

export const crewAgentScopeSchema = z
  .object({
    kind: z.literal("crew"),
    crewId: identifierSchema,
  })
  .strict();

export const agentScopeSchema = z.discriminatedUnion("kind", [
  storyAgentScopeSchema,
  crewAgentScopeSchema,
]);

const commonContextShape = {
  actorId: identifierSchema,
  actorDisplayName: z.string().trim().min(1).max(120),
  conversationId: z.uuid(),
  sessionName: z
    .string()
    .min(1)
    .max(128)
    .regex(
      /^agent:v1:conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    ),
  permissionMode: z.enum(["ask", "smart", "full"]),
  locale: z.string().min(2).max(35),
  roles: z.array(identifierSchema).max(64),
  permissions: z.array(identifierSchema).max(256),
  traceId: identifierSchema,
} as const;

const storySessionContextSchema = z
  .object({
    ...commonContextShape,
    surface: z.literal("story-studio"),
    scope: storyAgentScopeSchema,
  })
  .strict();

const crewSessionContextSchema = z
  .object({
    ...commonContextShape,
    surface: z.literal("crew-management"),
    scope: crewAgentScopeSchema,
  })
  .strict();

const agentSessionContextUnion = z.discriminatedUnion("surface", [
  storySessionContextSchema,
  crewSessionContextSchema,
]);

export type AgentSessionContext = z.infer<typeof agentSessionContextUnion>;

export function canonicalAgentSessionName(conversationId: string): string {
  return `agent:v1:conversation:${z.uuid().parse(conversationId)}`;
}

export function agentSecurityPartition(context: AgentSessionContext): string {
  return context.surface === "story-studio"
    ? `workspace.${context.scope.workspaceId}`
    : `crew.${context.scope.crewId}`;
}

export function agentMemoryScope(context: AgentSessionContext): Readonly<{
  threadId: string;
  resourceId: string;
}> {
  return Object.freeze({
    threadId: context.sessionName,
    resourceId: `${agentSecurityPartition(context)}:${context.actorId}`,
  });
}

export const agentSessionContextSchema = agentSessionContextUnion.superRefine(
  (context, issueContext) => {
    if (context.sessionName !== canonicalAgentSessionName(context.conversationId)) {
      issueContext.addIssue({
        code: "custom",
        path: ["sessionName"],
        message: "sessionName must match the signed conversation identity",
      });
    }
  }
);

export const gatewayClaimsSchema = z
  .object({
    sub: identifierSchema,
    agent_context: agentSessionContextSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    iss: z.string().optional(),
    aud: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough()
  .superRefine((claims, issueContext) => {
    if (claims.sub !== claims.agent_context.actorId) {
      issueContext.addIssue({
        code: "custom",
        path: ["agent_context"],
        message: "signed agent context must match the token subject",
      });
    }
    if (claims.exp <= claims.iat) {
      issueContext.addIssue({
        code: "custom",
        path: ["exp"],
        message: "gateway token expiration must be later than its issue time",
      });
    }
  });

export type GatewayClaims = z.infer<typeof gatewayClaimsSchema>;

const fizzDragonRequestContextUnion = z.discriminatedUnion("surface", [
  storySessionContextSchema.extend({
    [MASTRA_RESOURCE_ID_KEY]: z.string().min(1),
    [MASTRA_THREAD_ID_KEY]: z.string().min(1),
    [INFERENCE_TIER_KEY]: inferenceTierSchema,
    [CAUSAL_MESSAGE_IDS_KEY]: causalMessageIdsSchema,
    [CAUSAL_ATTACHMENT_IDS_KEY]: causalAttachmentIdsSchema,
  }),
  crewSessionContextSchema.extend({
    [MASTRA_RESOURCE_ID_KEY]: z.string().min(1),
    [MASTRA_THREAD_ID_KEY]: z.string().min(1),
    [INFERENCE_TIER_KEY]: inferenceTierSchema,
    [CAUSAL_MESSAGE_IDS_KEY]: causalMessageIdsSchema,
    [CAUSAL_ATTACHMENT_IDS_KEY]: causalAttachmentIdsSchema,
  }),
]);

export const fizzDragonRequestContextSchema = fizzDragonRequestContextUnion.superRefine(
  (context, issueContext) => {
    if (context.sessionName !== canonicalAgentSessionName(context.conversationId)) {
      issueContext.addIssue({
        code: "custom",
        path: ["sessionName"],
        message: "sessionName must match the signed conversation identity",
      });
    }
  }
);

export type FizzDragonRequestContext = AgentSessionContext & {
  [MASTRA_RESOURCE_ID_KEY]: string;
  [MASTRA_THREAD_ID_KEY]: string;
  [INFERENCE_TIER_KEY]: InferenceTier;
  [CAUSAL_MESSAGE_IDS_KEY]: string[];
  [CAUSAL_ATTACHMENT_IDS_KEY]: string[];
};

export function createAgentRequestContext(
  value: AgentSessionContext
): RequestContext<FizzDragonRequestContext> {
  const context = agentSessionContextSchema.parse(value);
  const memoryScope = agentMemoryScope(context);
  const requestContext = new RequestContext<FizzDragonRequestContext>();
  requestContext.set("actorId", context.actorId);
  requestContext.set("actorDisplayName", context.actorDisplayName);
  requestContext.set("conversationId", context.conversationId);
  requestContext.set("surface", context.surface);
  requestContext.set("scope", structuredClone(context.scope));
  requestContext.set("sessionName", context.sessionName);
  requestContext.set("permissionMode", context.permissionMode);
  requestContext.set("locale", context.locale);
  requestContext.set("roles", [...new Set(context.roles)]);
  requestContext.set("permissions", [...new Set(context.permissions)]);
  requestContext.set("traceId", context.traceId);
  requestContext.set(MASTRA_RESOURCE_ID_KEY, memoryScope.resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, memoryScope.threadId);
  requestContext.set(INFERENCE_TIER_KEY, "interactive");
  requestContext.set(CAUSAL_MESSAGE_IDS_KEY, []);
  requestContext.set(CAUSAL_ATTACHMENT_IDS_KEY, []);
  return requestContext;
}

export function writeAgentCausalContext(
  requestContext: RequestContext<FizzDragonRequestContext>,
  input: Readonly<{
    messageIds: readonly string[];
    attachmentIds: readonly string[];
  }>
): void {
  requestContext.set(
    CAUSAL_MESSAGE_IDS_KEY,
    causalMessageIdsSchema.parse([...new Set(input.messageIds)])
  );
  requestContext.set(
    CAUSAL_ATTACHMENT_IDS_KEY,
    causalAttachmentIdsSchema.parse([...new Set(input.attachmentIds)])
  );
}

export function readAgentSessionContext(
  requestContext: RequestContext<FizzDragonRequestContext>
): AgentSessionContext {
  return agentSessionContextSchema.parse({
    actorId: requestContext.get("actorId"),
    actorDisplayName: requestContext.get("actorDisplayName"),
    conversationId: requestContext.get("conversationId"),
    surface: requestContext.get("surface"),
    scope: requestContext.get("scope"),
    sessionName: requestContext.get("sessionName"),
    permissionMode: requestContext.get("permissionMode"),
    locale: requestContext.get("locale"),
    roles: requestContext.get("roles"),
    permissions: requestContext.get("permissions"),
    traceId: requestContext.get("traceId"),
  });
}
