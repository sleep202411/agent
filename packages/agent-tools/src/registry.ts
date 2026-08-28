import type { RiskLevel } from "@repo/agent-policy";

import { AGENT_OS_TOOLS, type AgentOsToolId } from "./definitions.js";
import { canonicalizeStoryCreativeProfileInputRequest } from "./story-creative-profile.js";
import type { ToolDefinition } from "./types.js";

const byId = new Map<string, ToolDefinition>(
  AGENT_OS_TOOLS.map((tool) => [tool.id, tool as ToolDefinition])
);

export function listTools(): readonly ToolDefinition[] {
  return AGENT_OS_TOOLS as unknown as readonly ToolDefinition[];
}

export function getTool(toolId: string): ToolDefinition {
  const tool = byId.get(toolId);
  if (!tool) {
    throw new UnknownToolError(toolId);
  }
  return tool;
}

export function isAgentOsToolId(toolId: string): toolId is AgentOsToolId {
  return byId.has(toolId);
}

export function riskForTool(toolId: string): RiskLevel {
  return getTool(toolId).risk;
}

export function parseToolInput(toolId: string, raw: unknown): unknown {
  const tool = getTool(toolId);
  return tool.inputSchema.parse(
    toolId === "request_user_input" ? canonicalizeStoryCreativeProfileInputRequest(raw) : raw
  );
}

export function parseToolOutput(toolId: string, raw: unknown): unknown {
  const tool = getTool(toolId);
  return tool.outputSchema.parse(raw);
}

/** OpenAI-style tool descriptors for model binding (name + description + json schema later). */
export function toolDescriptorsForModel(): ReadonlyArray<{
  id: string;
  description: string;
  kind: string;
  risk: RiskLevel;
}> {
  return listTools().map((tool) => ({
    id: tool.id,
    description: tool.description,
    kind: tool.kind,
    risk: tool.risk,
  }));
}

export class UnknownToolError extends Error {
  readonly toolId: string;

  constructor(toolId: string) {
    super(`Unknown Agent OS tool: ${toolId}`);
    this.name = "UnknownToolError";
    this.toolId = toolId;
  }
}
