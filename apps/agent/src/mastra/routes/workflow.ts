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
import { getMeta } from "../workflows/engine/state";
import { resolveAttachmentRefs } from "../lib/attachment-resolve";
import { WORKFLOW_NAMES, type WorkflowName } from "../lib/redis-keys";
import type { StoryosContext } from "../lib/workspace-client";
import { generateProjectCover } from "../tools/meta/generate-project-cover";
import { applySceneDrafts } from "../workflows/phases/scene-phase";
import { applyRoleDrafts } from "../workflows/phases/role-phase";
import { applyPropDrafts } from "../workflows/phases/prop-phase";
import { applyEpisodeDrafts } from "../workflows/phases/episode-phase";
import { applyScriptDrafts } from "../workflows/phases/script-phase";
import { applyStoryboardDrafts } from "../workflows/phases/storyboard-phase";

/**
 * Inject context-derived fields (projectId / worldId / episodeId /
 * targetEpisodeCount) into inputData unless caller already provided them.
 * Mirrors `invoke_workflow` tool's auto-injection so /workflow/start
 * produces inputData that passes phase workflow schemas (which require
 * these IDs).
 */
function injectContextDefaults(
  workflowName: WorkflowName,
  inputData: Record<string, unknown>,
  ctx: StoryosContext
): Record<string, unknown> {
  const needsEpisodeCount = workflowName === "episode_phase" || workflowName === "parse_script";
  return {
    projectId: ctx.projectId,
    ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
    ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
    ...(needsEpisodeCount &&
    typeof ctx.targetEpisodeCount === "number" &&
    ctx.targetEpisodeCount > 0
      ? { targetEpisodeCount: ctx.targetEpisodeCount }
      : {}),
    ...inputData,
  };
}

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
      const workflowName = body.workflowName as WorkflowName;

      // Mirror invoke_workflow tool's pre-flight: swap attachment refs in
      // inputData + auto-inject projectId/worldId/episodeId/targetEpisodeCount
      // from the context so phase schemas validate. Without this, frontend
      // button / PROJECT_PARAMS_CONFIRMED short-circuits that pass only
      // {textRef: "att_xxx"} would fail schema validation for parse_script
      // (projectId, text required).
      let rawInputData: Record<string, unknown> = {};
      if (body.inputData && typeof body.inputData === "object" && !Array.isArray(body.inputData)) {
        rawInputData = body.inputData as Record<string, unknown>;
      }
      let resolvedInputData: Record<string, unknown>;
      try {
        resolvedInputData = (await resolveAttachmentRefs(rawInputData, {
          projectId: ctx.projectId,
        })) as Record<string, unknown>;
      } catch (err) {
        throw new HTTPException(400, {
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const finalInputData = injectContextDefaults(workflowName, resolvedInputData, ctx);

      const { runId } = await startWorkflow({
        workflowName,
        inputData: finalInputData,
        ctx,
      });
      return c.json({ runId, workflowName });
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
  // HITL approval button. Routes based on which phase the run belongs to:
  //   - Post-Stage-C phases (scene_phase, …) → call the phase's apply
  //     helper directly; the Mastra run has already ended after emitting
  //     drafts, there's nothing to resume.
  //   - Legacy phases still using Mastra suspend → enqueue a resume job
  //     that runs applyDecisionStep inside the workflow.
  registerApiRoute("/workflow/:runId/confirm", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const runId = c.req.param("runId");
      const body = ConfirmRequestSchema.parse(await c.req.json());

      const meta = await getMeta(runId);
      const applyArgs = {
        ctx,
        runId,
        approved: body.approved,
        feedback: body.feedback,
        acceptedClientRefIds: body.acceptedClientRefIds,
        emitLifecycleMessage: body.emitLifecycleMessage ?? true,
      };
      // Return completion / failure payload so callers that pass
      // emitLifecycleMessage=false (Nest's confirmWorkflow short-circuit)
      // can embed it into their own synthetic assistant message.
      switch (meta?.workflowName) {
        case "scene_phase": {
          const r = await applySceneDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
        case "role_phase": {
          const r = await applyRoleDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
        case "prop_phase": {
          const r = await applyPropDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
        case "episode_phase": {
          const r = await applyEpisodeDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
        case "script_phase": {
          const r = await applyScriptDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
        case "storyboard_phase": {
          const r = await applyStoryboardDrafts(applyArgs);
          return c.json({ ok: true, completion: r.completion, failure: r.failure });
        }
      }

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

  // ─── POST /project/cover/generate ─────────────────────────────────
  // Thin HTTP wrapper over the generate_project_cover tool, so Nest's
  // PROJECT_PARAMS_CONFIRMED short-circuit can trigger cover generation
  // without going through a supervisor LLM turn. Tool is idempotent
  // (returns skipped:true when project already has imagePath), so
  // Nest calling this as fire-and-forget is safe.
  registerApiRoute("/project/cover/generate", {
    method: "POST",
    handler: async (c) => {
      const rc = c.get("requestContext");
      if (!rc) {
        throw new HTTPException(401, { message: "missing requestContext" });
      }
      const body = (await c.req.json().catch(() => ({}))) as { textRef?: string };
      const exec = generateProjectCover.execute;
      if (!exec) {
        throw new HTTPException(500, { message: "generate_project_cover has no execute fn" });
      }
      try {
        // Cast: Mastra's tool.execute signature expects the full tool context,
        // but all the cover tool uses from it is `requestContext`. Passing
        // just that keeps this route self-contained.
        const result = await (exec as (i: unknown, e: unknown) => Promise<unknown>)(
          { textRef: body.textRef },
          { requestContext: rc }
        );
        return c.json(result ?? { ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HTTPException(500, { message: `cover generation failed: ${msg}` });
      }
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
