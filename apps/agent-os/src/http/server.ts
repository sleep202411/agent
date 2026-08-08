import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DomainPort } from "@repo/agent-tools";
import { createLiteLlmChatModel, isLiveModelConfigured } from "@repo/model-router";

import { getAgentOsCheckpointer } from "../runtime/checkpointer.js";
import { createWorkerDomainPort } from "../runtime/http-domain-port.js";
import { LangGraphRunService } from "../runtime/langgraph-run-service.js";

/**
 * Minimal local HTTP surface for Agent OS Phase 1.
 * Nest agent-os-gateway authenticates and proxies here.
 *
 * Phase 1: free, no rate limit. Caller must still pass actorId + projectId.
 * Character tools use Nest Domain when AGENT_OS_DOMAIN_URL is set.
 * Checkpoints use Postgres when DATABASE_URL / AGENT_OS_CHECKPOINT_DATABASE_URL set.
 */

const service = new LangGraphRunService();
/** Per-project domain ports (HTTP+local composite or pure in-memory). */
const domainsByProject = new Map<string, DomainPort>();
/** runId → projectId for approval resume domain lookup. */
const runProject = new Map<string, string>();

function domainForProject(projectId: string): DomainPort {
  const existing = domainsByProject.get(projectId);
  if (existing) return existing;
  const domain = createWorkerDomainPort();
  domainsByProject.set(projectId, domain);
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
        const { listSkills } = await import("@repo/agent-skills");
        send(res, 200, {
          ok: true,
          product: "FizzDragon Agent Platform",
          codename: "Agent OS",
          liveModel: isLiveModelConfigured(),
          checkpoint:
            Boolean(process.env.AGENT_OS_CHECKPOINT_DATABASE_URL?.trim()) ||
            Boolean(process.env.DATABASE_URL?.trim())
              ? "postgres"
              : "memory",
          skills: listSkills().map((s) => ({
            id: s.id,
            source: s.source,
            alwaysOn: s.alwaysOn,
            surfaces: s.surfaces,
          })),
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
          attachmentIds?: string[];
          permissionMode?: "ask" | "smart" | "full";
          surface?: "storyboard" | "canvas" | "brief";
          /** Per-turn skill ids (composer). Mounted when registered in skill runtime. */
          skillIds?: string[];
          /** Project default skill ids (admin). Mounted when registered. */
          projectDefaultSkillIds?: string[];
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
        const domain = domainForProject(body.projectId);
        runProject.set(runId, body.projectId);
        const checkpointer = await getAgentOsCheckpointer();
        const model = createLiteLlmChatModel({
          profileId: body.modelProfileId,
        });
        const attachmentIds = (body.attachmentIds ?? []).filter(
          (id) => typeof id === "string" && id.length > 0
        );
        const message =
          attachmentIds.length > 0
            ? `${body.message}\n\n[Context: The user attached file(s) with attachmentId(s): ${attachmentIds.join(", ")}. Call script_read_section with those attachmentId values (sectionIndex starts at 0). Do not invent ids. Do not claim writes succeeded until upsert tools return ok.]`
            : body.message;
        // Async stream: return immediately; client polls /events for MessageDelta.
        const permissionMode =
          body.permissionMode === "ask" ||
          body.permissionMode === "smart" ||
          body.permissionMode === "full"
            ? body.permissionMode
            : "smart";
        const surface =
          body.surface === "canvas" || body.surface === "brief" || body.surface === "storyboard"
            ? body.surface
            : "storyboard";
        const turnSkillIds = (body.skillIds ?? []).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        );
        const projectDefaultSkillIds = (body.projectDefaultSkillIds ?? []).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        );
        const snapshot = service.beginStart({
          runId,
          projectId: body.projectId,
          conversationId: body.conversationId,
          actorId: body.actorId,
          sessionId: `agent-os:v1:conversation:${body.conversationId}`,
          message,
          modelProfileId: body.modelProfileId,
          permissionMode,
          surface,
          turnSkillIds: turnSkillIds.length > 0 ? turnSkillIds : undefined,
          projectDefaultSkillIds:
            projectDefaultSkillIds.length > 0 ? projectDefaultSkillIds : undefined,
          model,
          domain,
          checkpointer,
        });
        send(res, 202, {
          runId: snapshot.runId,
          status: snapshot.status,
          pendingApproval: snapshot.pendingApproval,
          assistantText: snapshot.assistantText ?? "",
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
          permissionMode?: "ask" | "smart" | "full";
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
        const checkpointer = await getAgentOsCheckpointer();
        const model = createLiteLlmChatModel({
          profileId: body.modelProfileId,
        });
        const permissionMode =
          body.permissionMode === "ask" ||
          body.permissionMode === "smart" ||
          body.permissionMode === "full"
            ? body.permissionMode
            : undefined;
        // A worker restart loses the in-memory run but not the LangGraph thread
        // checkpoint, so a pending approval is still answerable. Rebuild it
        // before resuming rather than telling the user "Unknown run".
        const known = await service.rehydrateFromCheckpoint({
          runId,
          conversationId: body.conversationId,
          projectId: body.projectId,
          actorId: body.actorId,
          sessionId: `agent-os:v1:conversation:${body.conversationId}`,
          modelProfileId: body.modelProfileId,
          model,
          domain,
          checkpointer,
          permissionMode,
        });
        if (!known) {
          send(res, 409, {
            error: {
              code: "APPROVAL_NOT_PENDING",
              message: "This run has no approval waiting. It may already have been answered.",
            },
          });
          return;
        }
        const snapshot = service.beginResumeApproval({
          runId,
          decision: body.decision,
          projectId: body.projectId,
          actorId: body.actorId,
          conversationId: body.conversationId,
          sessionId: `agent-os:v1:conversation:${body.conversationId}`,
          modelProfileId: body.modelProfileId,
          permissionMode,
          model,
          domain,
          checkpointer,
        });
        send(res, 200, {
          runId: snapshot.runId,
          status: snapshot.status,
          pendingApproval: snapshot.pendingApproval,
          assistantText: snapshot.assistantText ?? "",
          events: snapshot.journal.all(),
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
          pendingApproval: snapshot.pendingApproval,
          assistantText: snapshot.assistantText,
          events: snapshot.journal.listFrom(after),
        });
        return;
      }

      const cancelMatch = url.pathname.match(/^\/v1\/agent-os\/runs\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const runId = cancelMatch[1]!;
        const body = (await readJson(req)) as { reason?: string };
        const snapshot = service.cancel(
          runId,
          typeof body.reason === "string" && body.reason.trim()
            ? body.reason.trim()
            : "Stopped by user"
        );
        if (!snapshot) {
          send(res, 404, { error: { code: "RUN_NOT_FOUND", message: "Unknown runId" } });
          return;
        }
        send(res, 200, {
          runId: snapshot.runId,
          status: snapshot.status,
          pendingApproval: snapshot.pendingApproval,
          assistantText: snapshot.assistantText ?? "",
          events: snapshot.journal.all(),
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
        checkpoint:
          Boolean(process.env.AGENT_OS_CHECKPOINT_DATABASE_URL?.trim()) ||
          Boolean(process.env.DATABASE_URL?.trim())
            ? "postgres"
            : "memory",
      })}\n`
    );
  });
}
