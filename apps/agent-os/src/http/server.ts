import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MemorySaver } from "@langchain/langgraph";
import { createLiteLlmChatModel, isLiveModelConfigured } from "@repo/model-router";

import { InMemoryStoryDomain } from "../runtime/in-memory-domain.js";
import { LangGraphRunService } from "../runtime/langgraph-run-service.js";

/**
 * Minimal local HTTP surface for Agent OS Phase 1.
 * Nest agent-os-gateway authenticates and proxies here.
 *
 * Phase 1: free, no rate limit. Caller must still pass actorId + projectId.
 */

const service = new LangGraphRunService();
const checkpointer = new MemorySaver();
/** Per-project in-memory domain until Nest DomainPort is the source of truth. */
const domainsByProject = new Map<string, InMemoryStoryDomain>();
/** runId → projectId for approval resume domain lookup. */
const runProject = new Map<string, string>();

const DEFAULT_SCRIPT = [
  "林黛玉自贾母处来。贾宝玉笑道：妹妹来了。王熙凤协理宁国府。薛宝钗稳重端庄。",
].join("");

function domainForProject(projectId: string, scriptText?: string): InMemoryStoryDomain {
  let domain = domainsByProject.get(projectId);
  if (!domain) {
    domain = new InMemoryStoryDomain();
    domain.setScript(scriptText?.trim() || DEFAULT_SCRIPT, 100);
    domainsByProject.set(projectId, domain);
  } else if (scriptText?.trim()) {
    domain.setScript(scriptText.trim(), 100);
  }
  return domain;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const MODEL_ENV_HINT =
  "Set AGENT_OS_OPENAI_BASE_URL + AGENT_OS_OPENAI_API_KEY (or LITELLM_*) for live runs.";

export function createAgentOsHttpServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, {
          ok: true,
          product: "FizzDragon Agent Platform",
          codename: "Agent OS",
          liveModel: isLiveModelConfigured(),
          billing: "free",
          rateLimit: "disabled",
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/agent-os/runs") {
        if (!isLiveModelConfigured()) {
          send(res, 503, {
            error: {
              code: "MODEL_NOT_CONFIGURED",
              message: MODEL_ENV_HINT,
            },
          });
          return;
        }
        const body = (await readJson(req)) as {
          projectId?: string;
          conversationId?: string;
          actorId?: string;
          message?: string;
          modelProfileId?: string;
          scriptText?: string;
        };
        if (
          !body.projectId ||
          !body.conversationId ||
          !body.actorId ||
          !body.message ||
          !body.modelProfileId?.trim()
        ) {
          send(res, 400, {
            error: {
              code: "INVALID_REQUEST",
              message: "projectId, conversationId, actorId, message, modelProfileId are required",
            },
          });
          return;
        }
        const runId = crypto.randomUUID();
        const domain = domainForProject(body.projectId, body.scriptText);
        runProject.set(runId, body.projectId);
        const model = createLiteLlmChatModel({
          profileId: body.modelProfileId,
        });
        const snapshot = await service.start({
          runId,
          projectId: body.projectId,
          conversationId: body.conversationId,
          actorId: body.actorId,
          sessionId: `agent-os:v1:conversation:${body.conversationId}`,
          message: body.message,
          modelProfileId: body.modelProfileId,
          model,
          domain,
          checkpointer,
        });
        send(res, 202, {
          runId: snapshot.runId,
          status: snapshot.status,
          pendingApproval: snapshot.pendingApproval,
          events: snapshot.journal.all(),
        });
        return;
      }

      const approvalMatch = url.pathname.match(/^\/v1\/agent-os\/runs\/([^/]+)\/approvals$/);
      if (req.method === "POST" && approvalMatch) {
        const runId = approvalMatch[1]!;
        const body = (await readJson(req)) as {
          decision?: "approve" | "reject";
          projectId?: string;
          actorId?: string;
          conversationId?: string;
          modelProfileId?: string;
        };
        if (
          !body.decision ||
          !body.projectId ||
          !body.actorId ||
          !body.conversationId ||
          !body.modelProfileId?.trim()
        ) {
          send(res, 400, {
            error: {
              code: "INVALID_REQUEST",
              message: "decision, projectId, actorId, conversationId, modelProfileId are required",
            },
          });
          return;
        }
        if (!isLiveModelConfigured()) {
          send(res, 503, {
            error: {
              code: "MODEL_NOT_CONFIGURED",
              message: MODEL_ENV_HINT,
            },
          });
          return;
        }
        const projectId = runProject.get(runId) ?? body.projectId;
        const domain = domainForProject(projectId);
        const model = createLiteLlmChatModel({
          profileId: body.modelProfileId,
        });
        const snapshot = await service.resumeApproval({
          runId,
          decision: body.decision,
          projectId: body.projectId,
          actorId: body.actorId,
          conversationId: body.conversationId,
          sessionId: `agent-os:v1:conversation:${body.conversationId}`,
          modelProfileId: body.modelProfileId,
          model,
          domain,
          checkpointer,
        });
        send(res, 200, {
          runId: snapshot.runId,
          status: snapshot.status,
          assistantText: snapshot.assistantText,
          events: snapshot.journal.all(),
          characters: [...domain.characters.values()],
        });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/v1\/agent-os\/runs\/([^/]+)\/events$/);
      if (req.method === "GET" && eventsMatch) {
        const snapshot = service.getSnapshot(eventsMatch[1]!);
        if (!snapshot) {
          send(res, 404, { error: { code: "RUN_NOT_FOUND", message: "Unknown runId" } });
          return;
        }
        const after = Number(url.searchParams.get("after") ?? "0");
        send(res, 200, {
          runId: snapshot.runId,
          status: snapshot.status,
          events: snapshot.journal.listFrom(after),
        });
        return;
      }

      send(res, 404, { error: { code: "NOT_FOUND", message: "No such route" } });
    } catch (error) {
      send(res, 500, {
        error: {
          code: "INTERNAL",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  });
}

export function listenAgentOsHttp(port = Number(process.env.AGENT_OS_PORT ?? "4301")): void {
  const server = createAgentOsHttpServer();
  server.listen(port, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "agent-os.http.listen",
        port,
        billing: "free",
        rateLimit: "disabled",
      })}\n`
    );
  });
}
