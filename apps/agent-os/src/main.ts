/**
 * Agent OS worker entrypoint.
 *
 * Interactive runtime: LangGraph.js (createReactAgent) + tool interrupts.
 * Models: LiteLLM via @repo/model-router when env is configured.
 * Phase 1: free, no rate limit.
 */

import { FIZZ_AGENT_PROTOCOL_VERSION } from "@repo/agent-protocol";
import { listTools } from "@repo/agent-tools";
import { isLiveModelConfigured } from "@repo/model-router";

import { listenAgentOsHttp } from "./http/server.js";
import { AgentOsCheckpointExecutionSupersededError } from "./runtime/checkpointer.js";
import { resolveWorkerDomainMode } from "./runtime/http-domain-port.js";

/**
 * A superseded execution is an expected fencing race: a newer execution claimed
 * the run and the loser's next checkpoint write throws. The run service catches
 * this on its awaited paths, but LangGraph's PregelRunner can also surface it
 * from a floating promise, where it becomes an unhandled rejection and would
 * kill the whole worker. Swallow exactly this error — the losing execution is
 * already fenced out and the run is owned by its successor. Every other
 * rejection stays fatal (fail-loud). Matches by class OR stable code, since a
 * wrapped error or a duplicated module copy would defeat instanceof.
 */
function installSupersededRejectionPolicy(): void {
  process.on("unhandledRejection", (reason) => {
    const superseded =
      reason instanceof AgentOsCheckpointExecutionSupersededError ||
      (reason as { code?: string } | null)?.code === "AGENT_OS_CHECKPOINT_EXECUTION_SUPERSEDED";
    if (superseded) {
      process.stdout.write(
        `${JSON.stringify({
          level: "warn",
          msg: "agent-os.execution.superseded.async",
          detail: reason instanceof Error ? reason.message : String(reason),
        })}\n`
      );
      return;
    }
    throw reason;
  });
}

export function agentOsIdentity(): {
  product: string;
  codename: string;
  protocolVersion: string;
  runtime: string;
  phase1Tools: string[];
  goldenUseCases: string[];
  billing: "free";
  rateLimit: "disabled";
  liveModelConfigured: boolean;
} {
  return {
    product: "FizzDragon Agent Platform",
    codename: "Agent OS",
    protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
    runtime: "langgraph-js/createReactAgent",
    phase1Tools: listTools().map((tool) => tool.id),
    goldenUseCases: ["script→characters→project DB", "project canvas read/patch"],
    billing: "free",
    rateLimit: "disabled",
    liveModelConfigured: isLiveModelConfigured(),
  };
}

async function main(): Promise<void> {
  // Fail here rather than per-request: a worker that cannot reach the platform
  // must not accept runs it would silently write to a throwaway store, and the
  // internal token is the only thing guarding its privileged writes.
  const domainMode = resolveWorkerDomainMode();
  const identity = { ...agentOsIdentity(), domainMode };
  process.stdout.write(`${JSON.stringify({ level: "info", msg: "agent-os.boot", ...identity })}\n`);
  await listenAgentOsHttp();
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("/main.ts") ||
    process.argv[1].endsWith("/main.js") ||
    process.argv[1].endsWith("\\main.ts") ||
    process.argv[1].endsWith("\\main.js"));

if (isEntrypoint) {
  installSupersededRejectionPolicy();
  void main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        msg: "agent-os.boot.failed",
        error: error instanceof Error ? error.message : String(error),
      })}\n`
    );
    process.exitCode = 1;
  });
}
