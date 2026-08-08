import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DomainPort } from "@repo/agent-tools";
import {
  createLiteLlmChatModel,
  isLiveModelConfigured,
  loadModelProfiles,
  type ModelProfile,
} from "@repo/model-router";

import { getAgentOsCheckpointer } from "../runtime/checkpointer.js";
import { createWorkerDomainPort, resolveWorkerDomainMode } from "../runtime/http-domain-port.js";
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

/**
 * The gateway↔worker trust boundary, enforced INBOUND.
 *
 * This process holds the internal token that lets it write to Nest as any
 * actor, and it takes actorId/projectId from the request body — so anything
 * that can reach this port can impersonate any user on any project. The token
 * was only ever checked in the outbound direction; without this, network
 * reachability alone is full escalation.
 */
const INTERNAL_TOKEN_HEADER = "x-agent-os-internal-token";

function requiredInternalToken(): string {
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (!token || token.length < 16) {
    throw new Error(
      "AGENT_OS_INTERNAL_TOKEN must be set (16+ chars): it is the only thing " +
        "standing between this worker's privileged domain writes and its network."
    );
  }
  return token;
}

function isAuthorized(req: IncomingMessage): boolean {
  const expected = Buffer.from(requiredInternalToken());
  const header = req.headers[INTERNAL_TOKEN_HEADER];
  const presented = Buffer.from((Array.isArray(header) ? header[0] : header)?.trim() ?? "");
  // Length must match before timingSafeEqual, and comparing lengths first is
  // not the leak — the token length is not the secret.
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** Requests larger than this are refused before being buffered into memory. */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
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

/** Never let a health probe throw; report the misconfiguration instead. */
function safeDomainMode(): string {
  try {
    return resolveWorkerDomainMode();
  } catch {
    return "unconfigured";
  }
}

const MODEL_ENV_HINT =
  "Set AGENT_OS_OPENAI_BASE_URL + AGENT_OS_OPENAI_API_KEY (or LITELLM_*) for live runs.";

export function createAgentOsHttpServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      // /health is the only unauthenticated route — the kubelet probes it and
      // it reveals no run data. Every /v1 route acts on someone's project.
      if (url.pathname !== "/health" && !isAuthorized(req)) {
        send(res, 401, {
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid X-Agent-Os-Internal-Token.",
          },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const { listSkills } = await import("@repo/agent-skills");
        send(res, 200, {
          ok: true,
          product: "FizzDragon Agent Platform",
          codename: "Agent OS",
          liveModel: isLiveModelConfigured(),
          // Which store tools actually write to. Without this, a deploy that
          // silently fell back to memory looks identical to a healthy one.
          domain: safeDomainMode(),
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

      // Which models this worker can drive. It owns the answer because it owns
      // the model client — the gateway just relays it to the picker.
      if (req.method === "GET" && url.pathname === "/v1/agent-os/models") {
        send(res, 200, {
          models: loadModelProfiles().map((profile: ModelProfile) => ({
            id: profile.id,
            label: profile.label,
            ...(profile.hint ? { hint: profile.hint } : {}),
          })),
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
  /**
   * Loopback by default: on a developer host there is no reason for this port
   * to be reachable from the network. A deployment that puts the gateway in a
   * different pod must set 0.0.0.0 explicitly and rely on the internal token
   * plus a network policy — making that a deliberate choice rather than the
   * default is the point.
   */
  const host = process.env.AGENT_OS_BIND_ADDRESS?.trim() || "127.0.0.1";
  server.listen(port, host, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "agent-os.http.listen",
        port,
        host,
        domain: safeDomainMode(),
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
