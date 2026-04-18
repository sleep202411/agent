/**
 * Workflow + drafts HTTP routes, registered on the Mastra server.
 *
 * These routes sit under `/workflow/*` and `/drafts/*`. Auth context is
 * expected to be pre-validated upstream (NestJS gateway) and passed along
 * via the `x-storyos-context` header, which Mastra's server middleware
 * parses into `requestContext`.
 *
 * Shapes conform to the Zod schemas exported from `@repo/shared/workflow`
 * so the frontend's TanStack Query hooks and the backend stay in sync.
 */
import { registerApiRoute } from "@mastra/core/server";
import { HTTPException } from "hono/http-exception";
import {
  ConfirmRequestSchema,
  ResumeRequestSchema,
  type StatusResponse,
} from "@repo/shared/workflow";
import { listDrafts } from "../lib/drafts";
import {
  cancelWorkflow,
  getWorkflowStatus,
  listUserWorkflows,
  listWorkspaceWorkflows,
  readEvents,
  resumeWorkflow,
  startWorkflow,
} from "../workflows/engine";
import { WORKFLOW_NAMES, type WorkflowName } from "../lib/redis-keys";
import type { StoryosContext } from "../lib/workspace-client";

function requireContext(c: import("hono").Context): StoryosContext {
  const rc = c.get("requestContext");
  const userId = rc?.get("userId") as string | undefined;
  const projectId = rc?.get("projectId") as string | undefined;
  const cookie = rc?.get("cookie") as string | undefined;
  if (!userId || !projectId) {
    throw new HTTPException(401, {
      message: "missing userId/projectId in requestContext",
    });
  }
  return {
    cookie: cookie ?? "",
    userId,
    projectId,
    worldId: rc?.get("worldId") as string | undefined,
    episodeId: rc?.get("episodeId") as string | undefined,
    locale: rc?.get("locale") as string | undefined,
    acceptLanguage: rc?.get("acceptLanguage") as string | undefined,
  };
}

export const workflowRoutes = [
  // ─── POST /workflow/start ─────────────────────────────────────────
  // Deterministic workflow dispatch — bypasses the supervisor LLM entirely.
  // Used by frontend buttons like "继续 · 生成分镜" that know exactly which
  // workflow to run next. The LLM-routed path (invoke_workflow tool inside
  // the supervisor agent) still exists for freeform natural-language requests.
  registerApiRoute("/workflow/start", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = (await c.req.json()) as {
        workflowName?: string;
        inputData?: unknown;
      };
      if (!body.workflowName || !WORKFLOW_NAMES.includes(body.workflowName as WorkflowName)) {
        throw new HTTPException(400, {
          message: `invalid workflowName; expected one of ${WORKFLOW_NAMES.join(", ")}`,
        });
      }
      const { runId } = await startWorkflow({
        workflowName: body.workflowName as WorkflowName,
        inputData: body.inputData ?? {},
        ctx,
      });
      return c.json({ runId, workflowName: body.workflowName });
    },
  }),

  // ─── GET /workflow/:runId/status ──────────────────────────────────
  registerApiRoute("/workflow/:runId/status", {
    method: "GET",
    handler: async (c) => {
      const runId = c.req.param("runId");
      const meta = await getWorkflowStatus(runId);
      if (!meta) throw new HTTPException(404, { message: "workflow run not found" });

      // Recent events for the task card's activity feed.
      const recentEvents = await readEvents(runId, { limit: 20 });

      const resp: StatusResponse = {
        ...meta,
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          runId: e.runId,
          timestamp: e.timestamp,
          type: e.type,
          data: e.data,
        })),
      };
      return c.json(resp);
    },
  }),

  // ─── GET /workflow/:runId/events ──────────────────────────────────
  registerApiRoute("/workflow/:runId/events", {
    method: "GET",
    handler: async (c) => {
      const runId = c.req.param("runId");
      const limit = Math.min(Number(c.req.query("limit") ?? "100"), 1000);
      const fromId = c.req.query("fromId") ?? undefined;
      const events = await readEvents(runId, { limit, fromId });
      return c.json({ events });
    },
  }),

  // ─── POST /workflow/:runId/cancel ─────────────────────────────────
  registerApiRoute("/workflow/:runId/cancel", {
    method: "POST",
    handler: async (c) => {
      const runId = c.req.param("runId");
      await cancelWorkflow(runId);
      return c.json({ ok: true });
    },
  }),

  // ─── POST /workflow/:runId/resume ─────────────────────────────────
  // Raw resume for special cases (LLM-triggered, testing). Normal HITL
  // uses /workflow/:runId/confirm below.
  registerApiRoute("/workflow/:runId/resume", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const runId = c.req.param("runId");
      const body = ResumeRequestSchema.parse(await c.req.json());
      await resumeWorkflow({
        runId,
        resumeData: body.resumeData,
        stepId: body.stepId,
        ctx,
      });
      return c.json({ ok: true });
    },
  }),

  // ─── POST /workflow/:runId/confirm ────────────────────────────────
  // HITL approval button. The request body tells us what the user decided;
  // we repackage it as a resume payload and enqueue a resume job. The
  // workflow's post-HITL step reads drafts and commits via BatchWriter.
  registerApiRoute("/workflow/:runId/confirm", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const runId = c.req.param("runId");
      const body = ConfirmRequestSchema.parse(await c.req.json());
      await resumeWorkflow({
        runId,
        resumeData: {
          approved: body.approved,
          feedback: body.feedback,
          acceptedClientRefIds: body.acceptedClientRefIds,
        },
        ctx,
      });
      return c.json({ ok: true });
    },
  }),

  // ─── GET /drafts/:runId ────────────────────────────────────────────
  registerApiRoute("/drafts/:runId", {
    method: "GET",
    handler: async (c) => {
      const runId = c.req.param("runId");
      const entityType = c.req.query("entityType");
      const drafts = await listDrafts(runId, {
        entityType: entityType ? (entityType as never) : undefined,
      });
      return c.json({ runId, drafts });
    },
  }),

  // ─── GET /workflow/user/:userId ────────────────────────────────────
  registerApiRoute("/workflow/user/:userId", {
    method: "GET",
    handler: async (c) => {
      const ctx = requireContext(c);
      const userId = c.req.param("userId");
      if (userId !== ctx.userId) {
        throw new HTTPException(403, { message: "cannot list another user's workflows" });
      }
      const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
      const runs = await listUserWorkflows(userId, limit);
      return c.json({ runs });
    },
  }),

  // ─── GET /workflow/workspace/:workspaceId ──────────────────────────
  registerApiRoute("/workflow/workspace/:workspaceId", {
    method: "GET",
    handler: async (c) => {
      const ctx = requireContext(c);
      const workspaceId = c.req.param("workspaceId");
      if (workspaceId !== ctx.projectId) {
        throw new HTTPException(403, { message: "workspace id mismatch" });
      }
      const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
      const runs = await listWorkspaceWorkflows(workspaceId, limit);
      return c.json({ runs });
    },
  }),
];
