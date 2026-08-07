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

function main(): void {
  const identity = agentOsIdentity();
  process.stdout.write(`${JSON.stringify({ level: "info", msg: "agent-os.boot", ...identity })}\n`);
  listenAgentOsHttp();
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("/main.ts") ||
    process.argv[1].endsWith("/main.js") ||
    process.argv[1].endsWith("\\main.ts") ||
    process.argv[1].endsWith("\\main.js"));

if (isEntrypoint) {
  main();
}
