import type { AgentOsToolId } from "@repo/agent-tools";

export const AGENT_PROJECT_KINDS = ["platform", "story"] as const;
export type AgentProjectKind = (typeof AGENT_PROJECT_KINDS)[number];

/**
 * One workbench view inside a project kind.
 *
 * The mode owns declarative model context: its instructions and the exact tool
 * subset mounted for a turn. It never owns ACL or business execution.
 */
export interface AgentModeDefinition<TMode extends string = string> {
  projectKind: AgentProjectKind;
  mode: TMode;
  name: string;
  description: string;
  instructions: string;
  toolIds: readonly AgentOsToolId[];
}

/**
 * A data/ACL boundary. Runtime handlers are registered in Nest, not here.
 */
export interface AgentProjectKindDefinition<
  TKind extends AgentProjectKind = AgentProjectKind,
  TMode extends string = string,
> {
  projectKind: TKind;
  modes: readonly AgentModeDefinition<TMode>[];
}

export class UnknownAgentProjectKindError extends Error {
  constructor(readonly projectKind: string) {
    super(`Unknown Agent OS project kind: ${projectKind}`);
    this.name = "UnknownAgentProjectKindError";
  }
}

export class UnsupportedAgentModeError extends Error {
  constructor(
    readonly projectKind: string,
    readonly mode: string
  ) {
    super(`Agent OS mode ${mode} is not available for project kind ${projectKind}`);
    this.name = "UnsupportedAgentModeError";
  }
}
