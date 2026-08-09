import type { DomainPort, ToolExecuteResult, ToolExecutionContext } from "@repo/agent-tools";

import { InMemoryStoryDomain } from "./in-memory-domain.js";

/**
 * DomainPort that executes tools against Nest Agent OS domain HTTP API.
 * Every product read/write reaches the authoritative Nest domain.
 */
export class HttpDomainPort implements DomainPort {
  constructor(
    private readonly options: {
      baseUrl: string;
      internalToken: string;
    }
  ) {}

  async execute(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecuteResult> {
    // HTTP mode has exactly one product domain: Nest. It owns capability
    // routing and rejects unsupported tools; the worker never shadows that
    // registry or diverts a missing handler to an in-memory store.
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/internal/agent-os/tools/${encodeURIComponent(toolId)}/execute`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-os-internal-token": this.options.internalToken,
        },
        body: JSON.stringify({
          actorId: context.actorId,
          projectId: context.projectId,
          workbenchContext: context.workbenchContext,
          idempotencyKey: context.idempotencyKey,
          arguments: input,
        }),
        signal: context.abortSignal ?? AbortSignal.timeout(60_000),
      });
    } catch (error) {
      return {
        ok: false,
        code: "DOMAIN_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Domain HTTP failed",
        retryable: true,
      };
    }

    const json = (await res.json()) as ToolExecuteResult;
    if (
      typeof json === "object" &&
      json !== null &&
      "ok" in json &&
      typeof (json as { ok: unknown }).ok === "boolean"
    ) {
      return json;
    }
    return {
      ok: false,
      code: "DOMAIN_MALFORMED_RESPONSE",
      message: `Unexpected domain response HTTP ${res.status}`,
      retryable: false,
      details: { body: json },
    };
  }
}

/**
 * Prefer Nest domain when AGENT_OS_DOMAIN_URL + AGENT_OS_INTERNAL_TOKEN are set;
 * otherwise in-memory (unit tests / offline demos).
 */
export type WorkerDomainMode = "http" | "memory";

/**
 * Which store the worker's tools write to — and a hard failure when that is
 * ambiguous.
 *
 * Falling back to the in-memory domain when the gateway env is missing looks
 * harmless and is the worst outcome available: tools return ok, the model tells
 * the user their characters and shots were written, the transcript reads
 * perfectly, and nothing reached Postgres or the canvas. A misconfigured deploy
 * has to refuse to start, not pretend to work.
 */
export function resolveWorkerDomainMode(): WorkerDomainMode {
  const domainUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (domainUrl && token && token.length >= 16) return "http";

  if (process.env.AGENT_OS_DOMAIN?.trim() === "memory") return "memory";

  throw new Error(
    "Agent OS domain is not configured: set AGENT_OS_DOMAIN_URL and " +
      "AGENT_OS_INTERNAL_TOKEN (16+ chars) to write to the platform, or set " +
      "AGENT_OS_DOMAIN=memory to run against the throwaway in-memory store."
  );
}

export function createWorkerDomainPort(_scriptText?: string): DomainPort {
  const local = new InMemoryStoryDomain();
  // Offline demos / tests: seed a default script under a fixed attachment id.
  local.setScript(
    "林黛玉自贾母处来。贾宝玉笑道：妹妹来了。王熙凤协理宁国府。薛宝钗稳重端庄。",
    100
  );

  if (resolveWorkerDomainMode() === "memory") return local;

  return new HttpDomainPort({
    baseUrl: process.env.AGENT_OS_DOMAIN_URL!.trim(),
    internalToken: process.env.AGENT_OS_INTERNAL_TOKEN!.trim(),
  });
}
