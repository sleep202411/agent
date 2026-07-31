import type { Tool } from "@mastra/core/tools";
import type { z } from "zod";

import type { AgentSessionContext } from "../context/agent-context.js";
import type { AgentRuntimeDomainGateway, DomainToolResult } from "../domain/domain-gateway.js";

export type ToolApprovalClass = "none" | "routine" | "sensitive" | "critical";

export type CapabilityToolDefinition<TInputSchema extends z.ZodType = z.ZodType> = Readonly<{
  id: string;
  description: string;
  inputSchema: TInputSchema;
  requiredPermission: string;
  approvalClass: ToolApprovalClass | ((input: z.output<TInputSchema>) => ToolApprovalClass);
  execute: (input: {
    arguments: z.output<TInputSchema>;
    context: AgentSessionContext;
    idempotencyKey: string;
    gateway: AgentRuntimeDomainGateway;
    signal?: AbortSignal;
  }) => Promise<DomainToolResult>;
}>;

export type CapabilityPack = Readonly<{
  id: string;
  surface: AgentSessionContext["surface"];
  instructions: string;
  tools: ReadonlyArray<CapabilityToolDefinition>;
}>;

export type InferenceToolRegistry = Record<string, Tool>;
