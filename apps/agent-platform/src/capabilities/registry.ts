import { createTool } from "@mastra/core/tools";

import type { AgentSessionContext } from "../context/agent-context.js";
import { crewManagementCapabilityPack } from "./crew-management/tools.js";
import { storyStudioCapabilityPack } from "./story-studio/tools.js";
import type {
  CapabilityPack,
  CapabilityToolDefinition,
  InferenceToolRegistry,
  ToolApprovalClass,
} from "./types.js";

const packs = new Map<AgentSessionContext["surface"], CapabilityPack>([
  ["story-studio", storyStudioCapabilityPack],
  ["crew-management", crewManagementCapabilityPack],
]);

export function getCapabilityPack(context: AgentSessionContext): CapabilityPack {
  const pack = packs.get(context.surface);
  if (!pack) {
    throw new Error(`No capability pack is registered for surface ${context.surface}`);
  }
  return pack;
}

export function listAuthorizedToolDefinitions(
  context: AgentSessionContext
): ReadonlyArray<CapabilityToolDefinition> {
  const permissions = new Set(context.permissions);
  return getCapabilityPack(context).tools.filter((definition) =>
    permissions.has(definition.requiredPermission)
  );
}

export function createInferenceTools(context: AgentSessionContext): InferenceToolRegistry {
  return Object.fromEntries(
    listAuthorizedToolDefinitions(context).map((definition) => [
      definition.id,
      createTool({
        id: definition.id,
        description: definition.description,
        inputSchema: definition.inputSchema,
        requireApproval: (input) => requiresToolApproval(context, definition, input),
      }),
    ])
  );
}

export function requiresToolApproval(
  context: AgentSessionContext,
  definition: CapabilityToolDefinition,
  input: unknown
): boolean {
  const approvalClass: ToolApprovalClass =
    typeof definition.approvalClass === "function"
      ? definition.approvalClass(input)
      : definition.approvalClass;

  if (approvalClass === "none") return false;
  if (context.permissionMode === "ask") return true;
  if (context.permissionMode === "smart") {
    return approvalClass === "sensitive" || approvalClass === "critical";
  }
  return approvalClass === "critical";
}

export function getAuthorizedToolDefinition(
  context: AgentSessionContext,
  toolId: string
): CapabilityToolDefinition {
  const definition = listAuthorizedToolDefinitions(context).find(
    (candidate) => candidate.id === toolId
  );
  if (!definition) {
    throw new CapabilityDeniedError(toolId);
  }
  return definition;
}

export class CapabilityDeniedError extends Error {
  readonly toolId: string;

  constructor(toolId: string) {
    super(`Tool ${toolId} is not authorized in this session`);
    this.name = "CapabilityDeniedError";
    this.toolId = toolId;
  }
}
