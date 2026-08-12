import type { AgentProjectKind } from '@repo/agent-capabilities';

export interface AgentOsCapabilityExecuteInput {
  toolId: string;
  actorId: string;
  projectId: string;
  skillResolutionId: string;
  skillVersionIds: readonly string[];
  workbenchContext?: Readonly<Record<string, string>>;
  idempotencyKey: string;
  arguments: unknown;
}

/** Compiled business execution boundary for one Agent OS project kind. */
export interface AgentOsCapabilityHandler {
  readonly projectKind: AgentProjectKind;
  supports(toolId: string): boolean;
  execute(input: AgentOsCapabilityExecuteInput): Promise<unknown>;
}
