export const AGENT_ACTIVITY_LANES = [
  "control",
  "inference",
  "tool",
  "lifecycle",
  "cleanup",
  "document",
] as const;

export type AgentActivityLane = (typeof AGENT_ACTIVITY_LANES)[number];

export type AgentTaskQueues = Readonly<{ workflow: string } & Record<AgentActivityLane, string>>;

/**
 * Derive every execution lane from the one deployment-owned base queue.
 * Workflows only need to persist the base queue; activity routing remains
 * deterministic across replay and environment-independent workflow bundles.
 */
export function agentTaskQueues(baseTaskQueue: string): AgentTaskQueues {
  const base = baseTaskQueue.trim();
  if (!base || base.length > 220) {
    throw new Error("Temporal base task queue must contain 1-220 characters");
  }
  return Object.freeze({
    workflow: base,
    control: `${base}-control`,
    inference: `${base}-inference`,
    tool: `${base}-tool`,
    lifecycle: `${base}-lifecycle`,
    cleanup: `${base}-cleanup`,
    document: `${base}-document`,
  });
}
