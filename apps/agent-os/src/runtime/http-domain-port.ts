import type { DomainPort, ToolExecuteResult, ToolExecutionContext } from "@repo/agent-tools";

import { InMemoryStoryDomain } from "./in-memory-domain.js";

/**
 * DomainPort that executes tools against Nest Agent OS domain HTTP API.
 * Character writes hit real PostgreSQL story drafts.
 */
export class HttpDomainPort implements DomainPort {
  constructor(
    private readonly options: {
      baseUrl: string;
      internalToken: string;
      /** Tools that must go to Nest domain (real DB). */
      remoteToolIds?: ReadonlySet<string>;
      /** Local fallback for query tools not yet remote (e.g. script sections). */
      local?: DomainPort;
    }
  ) {}

  async execute(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecuteResult> {
    const remote = this.options.remoteToolIds ?? new Set(["characters.list", "characters.upsert"]);
    if (!remote.has(toolId)) {
      if (!this.options.local) {
        return {
          ok: false,
          code: "TOOL_NOT_SUPPORTED",
          message: `No domain handler for ${toolId}`,
          retryable: false,
        };
      }
      return this.options.local.execute(toolId, input, context);
    }

    const url = `${this.options.baseUrl.replace(/\/$/, "")}/agent-os/internal/tools/${encodeURIComponent(toolId)}/execute`;
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
export function createWorkerDomainPort(scriptText?: string): DomainPort {
  const domainUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  const local = new InMemoryStoryDomain();
  if (scriptText?.trim()) {
    local.setScript(scriptText.trim(), 100);
  } else {
    local.setScript(
      "林黛玉自贾母处来。贾宝玉笑道：妹妹来了。王熙凤协理宁国府。薛宝钗稳重端庄。",
      100
    );
  }

  if (domainUrl && token && token.length >= 16) {
    return new HttpDomainPort({
      baseUrl: domainUrl,
      internalToken: token,
      local,
    });
  }
  return local;
}
