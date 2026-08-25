import type { DomainPort, ToolExecuteResult, ToolExecutionContext } from "@repo/agent-tools";

import { InMemoryStoryDomain } from "./in-memory-domain.js";

export class AgentOsExecutionSupersededError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentOsExecutionSupersededError";
    this.code = code;
  }
}

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
    let attempt = 0;
    for (;;) {
      throwIfAborted(context.abortSignal);
      const response = await this.executeOnce(url, toolId, input, context);
      if (!response.retryTransport) {
        return response.result;
      }
      // A transport error or IN_FLIGHT response says nothing about whether the
      // product transaction committed. Returning it as ToolFailed would teach
      // the model a false outcome. Stay inside this exact tool invocation until
      // the durable receipt becomes terminal, its lease can be reclaimed, or
      // the creator stops the run. Worker-process loss is recovered from the
      // same LangGraph checkpoint and toolCall/idempotency identity.
      await retryDelay([150, 400, 900, 1_500, 2_000][attempt] ?? 2_000, context.abortSignal);
      attempt += 1;
    }
  }

  private async executeOnce(
    url: string,
    toolId: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<{ result: ToolExecuteResult; retryTransport: boolean }> {
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(60_000);
      const requestSignal = context.abortSignal
        ? AbortSignal.any([context.abortSignal, timeout])
        : timeout;
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-os-internal-token": this.options.internalToken,
        },
        body: JSON.stringify({
          runId: context.runId,
          turnId: context.turnId,
          conversationId: context.conversationId,
          toolCallId: context.toolCallId,
          actorId: context.actorId,
          projectId: context.projectId,
          skillResolutionId: context.skillResolutionId,
          skillVersionIds: context.skillVersionIds,
          workbenchContext: context.workbenchContext,
          idempotencyKey: context.idempotencyKey,
          startExecution: context.startExecution,
          continuationExecution: context.continuationExecution,
          arguments: input,
        }),
        signal: requestSignal,
      });
    } catch (error) {
      // Stop is control flow, not an ambiguous Domain result. Propagating the
      // abort lets the run service cancel cleanly without writing ToolFailed.
      if (context.abortSignal?.aborted) throw abortReason(context.abortSignal);
      return {
        result: {
          ok: false,
          code: "DOMAIN_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Domain HTTP failed",
          retryable: true,
        },
        retryTransport: true,
      };
    }

    let json: ToolExecuteResult;
    try {
      json = (await res.json()) as ToolExecuteResult;
    } catch (error) {
      return {
        result: {
          ok: false,
          code: "DOMAIN_UNAVAILABLE",
          message:
            error instanceof Error
              ? `Domain response was lost: ${error.message}`
              : "Domain response was lost",
          retryable: true,
        },
        retryTransport: true,
      };
    }
    if (
      typeof json === "object" &&
      json !== null &&
      "ok" in json &&
      typeof (json as { ok: unknown }).ok === "boolean"
    ) {
      if (!json.ok && isExecutionFenceCode(json.code)) {
        // A stale epoch is control flow, not a tool outcome. Returning this as
        // ToolExecuteResult would make the tools node persist a false
        // ToolMessage/ToolFailed into the shared LangGraph checkpoint before
        // the journal CAS can reject the old Worker.
        throw new AgentOsExecutionSupersededError(json.code, json.message);
      }
      return {
        result: json,
        retryTransport:
          !json.ok &&
          json.retryable &&
          (res.status >= 500 ||
            json.code === "DOMAIN_UNAVAILABLE" ||
            json.code === "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT"),
      };
    }
    return {
      result: {
        ok: false,
        code: "DOMAIN_MALFORMED_RESPONSE",
        message: `Unexpected domain response HTTP ${res.status}`,
        retryable: false,
        details: { body: json },
      },
      retryTransport: false,
    };
  }
}

function isExecutionFenceCode(code: string): boolean {
  return (
    code === "AGENT_OS_START_EXECUTION_FENCED" ||
    code === "AGENT_OS_CONTINUATION_EXECUTION_FENCED" ||
    code === "AGENT_OS_TOOL_EXECUTION_SUPERSEDED" ||
    code === "AGENT_OS_RUN_TERMINAL"
  );
}

async function retryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal ? abortReason(signal) : new DOMException("Aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
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
