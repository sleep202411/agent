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
import { ConfirmRequestSchema } from "@repo/shared/workflow";
import { getDraft, listDrafts, patchDraft } from "../lib/drafts";
import { cancelWorkflow, resumeWorkflow, startWorkflow } from "../workflows/engine";
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

  // ─── POST /workflow/:runId/cancel ─────────────────────────────────
  registerApiRoute("/workflow/:runId/cancel", {
    method: "POST",
    handler: async (c) => {
      const runId = c.req.param("runId");
      await cancelWorkflow(runId);
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

  // ─── POST /drafts/:runId/:clientRefId — patch draft.data ──────────
  // Used by the UI's DraftDetailDialog to persist inline edits (e.g. the
  // Seedance 2.0 prompt wrapper) back into Redis so the workflow's resume
  // picks up the edited fields instead of the original LLM output.
  // Body: `{ data: Partial<DraftData> }` — shallow-merged into existing data.
  registerApiRoute("/drafts/:runId/:clientRefId", {
    method: "POST",
    handler: async (c) => {
      const runId = c.req.param("runId");
      const clientRefId = c.req.param("clientRefId");
      const body = (await c.req.json()) as { data?: Record<string, unknown> };
      if (!body?.data || typeof body.data !== "object") {
        throw new HTTPException(400, { message: "body.data must be an object" });
      }
      const existing = await getDraft<Record<string, unknown>>(runId, clientRefId);
      if (!existing) {
        throw new HTTPException(404, { message: "draft not found" });
      }
      if (existing.status !== "pending") {
        throw new HTTPException(409, {
          message: `draft status is ${existing.status}, only pending drafts can be edited`,
        });
      }
      const mergedData = { ...existing.data, ...body.data };
      const updated = await patchDraft<Record<string, unknown>>(runId, clientRefId, {
        data: mergedData,
      });
      return c.json({ draft: updated });
    },
  }),
];
