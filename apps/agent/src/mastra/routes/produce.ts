/**
 * Produce-mode routes.
 *
 * These routes are deliberately separate from StoryOS chat and the legacy
 * phase workflow API. Step 1 creates an ephemeral analysis draft; only the
 * explicit commit route writes Java business data.
 */
import { randomUUID } from "node:crypto";
import { registerApiRoute } from "@mastra/core/server";
import { RequestContext } from "@mastra/core/request-context";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getRedis } from "../lib/redis-client";
import { K, TTL } from "../lib/redis-keys";
import { javaRequest, type StoryosContext } from "../lib/workspace-client";
import {
  batchUpsertProps,
  batchUpsertRoles,
  batchUpsertScenes,
} from "../lib/batch-writers/world-assets";
import { getMeta, putMeta, requestCancel, setStatus } from "../workflows/engine";
import {
  ProducePipelineInputSchema,
  ProducePipelineOutputSchema,
} from "../workflows/produce-script-pipeline";
import { Step1OutputSchema } from "../workflows/produce-step1-episodes";
import { Step2InputSchema, Step2OutputSchema } from "../workflows/produce-step2-assets";

const CommitRequestSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  worldId: z.string().min(1).optional(),
});

const SyncRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  worldId: z.string().min(1).optional(),
  seed: ProducePipelineInputSchema.shape.seed,
});

const STORYBOARD_HEADERS = [
  "shot_no",
  "scene",
  "description",
  "image_prompt",
  "video_prompt",
  "style_planting",
  "movement",
  "dialogue",
  "shot_size",
  "perspective",
  "duration",
] as const;

type ProduceDraft = z.infer<typeof ProducePipelineOutputSchema>;

type CommitState = {
  status: "committing" | "completed" | "failed";
  startedAt: number;
  updatedAt: number;
  episodeIds?: Array<{ clientRefId: string; episodeId: string; title: string }>;
  result?: ProduceCommitResult;
  error?: string;
};

type ProduceCommitResult = {
  projectId: string;
  worldId: string;
  title: string;
  committedAt: number;
  episodes: Array<{
    clientRefId: string;
    episodeId: string;
    no: number;
    title: string;
    scriptChars: number;
    shotCount: number;
  }>;
  assets: {
    characters: Array<CommittedAsset>;
    scenes: Array<CommittedAsset>;
    props: Array<CommittedAsset>;
  };
  totals: {
    episodeCount: number;
    characterCount: number;
    sceneCount: number;
    propCount: number;
    shotCount: number;
  };
};

type CommittedAsset = {
  clientRefId: string;
  assetType: "role" | "scene" | "prop";
  assetId: string;
  name: string;
  description: string;
  prompt: string;
};

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
    dialogLanguage: rc?.get("dialogLanguage") as string | undefined,
    stylePainting: rc?.get("stylePainting") as string | undefined,
  };
}

export const produceRoutes = [
  registerApiRoute("/produce/script-draft/sync", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = SyncRequestSchema.parse(await c.req.json());
      const projectId = body.projectId ?? ctx.projectId;
      if (projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      const worldId = body.worldId ?? body.seed.worldId ?? ctx.worldId;
      const fullCtx: StoryosContext = {
        ...ctx,
        projectId,
        worldId,
        targetEpisodeCount: body.seed.episodeCount,
        dialogLanguage: body.seed.language,
      };
      const input = ProducePipelineInputSchema.parse({
        projectId,
        worldId,
        seed: { ...body.seed, worldId },
      });

      // Synchronous run-in-process. The frontend simply awaits the
      // response (no polling, no resume-on-refresh). We still
      // generate a runId and write Redis meta in lockstep with the
      // worker path so /commit's `getMeta(runId)` lookup keeps
      // working unchanged — the only difference between this route
      // and the legacy queued path is that no BullMQ job exists
      // and there's no restart-recovery. If the agent process dies
      // mid-run, the client's fetch errors out and the user just
      // hits "重试", which fires this route fresh.
      const runId = randomUUID();
      const now = Date.now();
      await putMeta({
        runId,
        workflowName: "produce_script_pipeline",
        workspaceId: projectId,
        userId: ctx.userId,
        status: "running",
        startedAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
      });

      // Wire client disconnect → workflow cancel. Without this, a
      // browser refresh / tab close detaches the HTTP socket but the
      // workflow keeps running to completion in the background — every
      // refresh stacks another 9-10 min of LLM work the client can
      // never receive. The downstream steps each call
      // `throwIfCancelled(runId)` between LLM hops; setting the Redis
      // cancel flag here lets the next step transition unwind cleanly
      // (the in-flight LLM call itself can't be aborted mid-stream,
      // but the very next step boundary will see the flag and throw
      // `WorkflowCancelledError`).
      const clientSignal = c.req.raw?.signal;
      let clientCancelled = false;
      const onClientAbort = () => {
        clientCancelled = true;
        // Best-effort — Redis hiccup here doesn't deserve a 500.
        void requestCancel(runId).catch((err) => {
          console.warn(
            `[produce] requestCancel(${runId}) failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
      };
      clientSignal?.addEventListener("abort", onClientAbort, { once: true });

      // Mastra registers the singleton on the Hono context. The cast
      // is needed because @mastra/core types `c.get` as
      // `Record<string, unknown>` rather than narrowing the known keys.
      type MastraLike = {
        getWorkflowById: (
          name: string
        ) => { createRun: (opts: { runId: string }) => Promise<unknown> } | undefined;
      };
      const mastra = c.get("mastra" as never) as MastraLike | undefined;
      const workflow = mastra?.getWorkflowById("produce_script_pipeline");
      if (!workflow) {
        await setStatus(runId, "failed", { error: "produce_script_pipeline not registered" });
        throw new HTTPException(500, {
          message: "produce_script_pipeline workflow is not registered on this Mastra instance",
        });
      }

      // Mirror the worker's RequestContext shape so steps that read
      // dialogLanguage / targetEpisodeCount / runId / etc. behave
      // identically regardless of which entry point invoked them.
      const requestContext = new RequestContext();
      requestContext.set("cookie", fullCtx.cookie);
      requestContext.set("userId", fullCtx.userId);
      requestContext.set("projectId", fullCtx.projectId);
      if (fullCtx.worldId) requestContext.set("worldId", fullCtx.worldId);
      if (fullCtx.episodeId) requestContext.set("episodeId", fullCtx.episodeId);
      if (fullCtx.locale) requestContext.set("locale", fullCtx.locale);
      if (fullCtx.acceptLanguage) requestContext.set("acceptLanguage", fullCtx.acceptLanguage);
      if (fullCtx.dialogLanguage) requestContext.set("dialogLanguage", fullCtx.dialogLanguage);
      if (fullCtx.stylePainting) requestContext.set("stylePainting", fullCtx.stylePainting);
      if (typeof fullCtx.targetEpisodeCount === "number") {
        requestContext.set("targetEpisodeCount", fullCtx.targetEpisodeCount);
      }
      requestContext.set("runId", runId);

      try {
        const run = (await workflow.createRun({ runId })) as {
          start: (opts: { inputData: unknown; requestContext: RequestContext }) => Promise<unknown>;
        };
        const raw = await run.start({ inputData: input, requestContext });
        const r = (raw ?? {}) as {
          status?: string;
          result?: unknown;
          error?: unknown;
        };
        if (clientCancelled) {
          // Client already gave up — nothing to write back. The
          // throwIfCancelled-driven cancel may still produce a
          // success/failed shape from Mastra; treat it as cancelled
          // for our state machine.
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          // No response needed — the socket is closed; Hono will skip.
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (r.status !== "success") {
          const message =
            r.error instanceof Error
              ? r.error.message
              : typeof r.error === "string"
                ? r.error
                : `workflow ${r.status ?? "unknown"}`;
          await setStatus(runId, "failed", { error: message });
          throw new HTTPException(500, { message });
        }
        await setStatus(runId, "completed", { result: r.result });
        const draft = ProducePipelineOutputSchema.parse(r.result);
        return c.json({ runId, draft });
      } catch (err) {
        if (clientCancelled) {
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (err instanceof HTTPException) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await setStatus(runId, "failed", { error: message });
        throw new HTTPException(500, { message });
      } finally {
        clientSignal?.removeEventListener("abort", onClientAbort);
      }
    },
  }),

  registerApiRoute("/produce/script-draft/commit", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = CommitRequestSchema.parse(await c.req.json());
      const meta = await getMeta(body.runId);
      if (!meta || meta.workflowName !== "produce_script_pipeline") {
        throw new HTTPException(404, { message: "produce draft not found" });
      }
      if (meta.status !== "completed") {
        throw new HTTPException(409, { message: `draft is not ready: ${meta.status}` });
      }
      const draft = ProducePipelineOutputSchema.parse(meta.result);
      if (draft.projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      const worldId = body.worldId ?? draft.worldId ?? ctx.worldId;
      if (!worldId) {
        throw new HTTPException(400, { message: "worldId required before committing assets" });
      }

      const commitKey = K.produceCommit(ctx.projectId, body.runId);
      const existing = await readCommitState(commitKey);
      if (existing?.status === "completed" && existing.result) {
        return c.json({ ok: true, result: existing.result, reused: true });
      }
      if (existing?.status === "committing" && Date.now() - existing.startedAt < 10 * 60_000) {
        throw new HTTPException(409, { message: "commit already in progress" });
      }

      const state: CommitState = existing ?? {
        status: "committing",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await writeCommitState(commitKey, { ...state, status: "committing", updatedAt: Date.now() });

      try {
        const result = await commitProduceDraft({
          ctx: { ...ctx, worldId },
          runId: body.runId,
          draft: { ...draft, worldId },
          state,
          commitKey,
        });
        await writeCommitState(commitKey, {
          ...state,
          status: "completed",
          updatedAt: Date.now(),
          result,
          error: undefined,
        });
        await getRedis().set(
          K.produceLatestCommit(ctx.projectId),
          JSON.stringify(result),
          "EX",
          TTL.PRODUCE_DRAFT
        );
        return c.json({ ok: true, result, reused: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeCommitState(commitKey, {
          ...state,
          status: "failed",
          updatedAt: Date.now(),
          error: message,
        });
        throw new HTTPException(500, { message });
      }
    },
  }),

  registerApiRoute("/produce/script-draft/committed", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const raw = await getRedis().get(K.produceLatestCommit(ctx.projectId));
      if (!raw) {
        return c.json({ ok: true, result: null });
      }
      try {
        return c.json({ ok: true, result: JSON.parse(raw) as ProduceCommitResult });
      } catch {
        throw new HTTPException(500, { message: "committed produce result is corrupted" });
      }
    },
  }),

  // ─── Step 1: episodes + scripts ───────────────────────────────────
  //
  // Slice of the old `script-draft/sync` flow that ends after
  // scripts. Web flow:
  //
  //   /generate → returns { runId, draft } (Mastra workflow ran in-
  //               process, draft cached in Redis via setStatus completed)
  //   /commit   → user clicks 保存继续, draft → Java (episodes + scripts
  //               only, NO assets / NO storyboards — those are step 2/3)
  //
  // Same client-disconnect → cancel pattern as the legacy route. Step 2
  // and Step 3 follow identical lifecycles in their own routes.
  registerApiRoute("/produce/step1/generate", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = SyncRequestSchema.parse(await c.req.json());
      const projectId = body.projectId ?? ctx.projectId;
      if (projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      const worldId = body.worldId ?? body.seed.worldId ?? ctx.worldId;
      const fullCtx: StoryosContext = {
        ...ctx,
        projectId,
        worldId,
        targetEpisodeCount: body.seed.episodeCount,
        dialogLanguage: body.seed.language,
      };
      const input = ProducePipelineInputSchema.parse({
        projectId,
        worldId,
        seed: { ...body.seed, worldId },
      });

      const runId = randomUUID();
      const now = Date.now();
      await putMeta({
        runId,
        workflowName: "produce_step1_episodes",
        workspaceId: projectId,
        userId: ctx.userId,
        status: "running",
        startedAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
      });
      // Stash the active runId so refresh / a parallel client tab can
      // discover an in-flight Step 1 run and attach to it instead of
      // starting a fresh one. Cleared on terminal status below.
      await getRedis().set(K.produceStep1Active(projectId), runId, "EX", TTL.PRODUCE_DRAFT);

      const clientSignal = c.req.raw?.signal;
      let clientCancelled = false;
      const onClientAbort = () => {
        clientCancelled = true;
        void requestCancel(runId).catch((err) => {
          console.warn(
            `[produce/step1] requestCancel(${runId}) failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
      };
      clientSignal?.addEventListener("abort", onClientAbort, { once: true });

      type MastraLike = {
        getWorkflowById: (
          name: string
        ) => { createRun: (opts: { runId: string }) => Promise<unknown> } | undefined;
      };
      const mastra = c.get("mastra" as never) as MastraLike | undefined;
      const workflow = mastra?.getWorkflowById("produce_step1_episodes");
      if (!workflow) {
        await setStatus(runId, "failed", { error: "produce_step1_episodes not registered" });
        await getRedis().del(K.produceStep1Active(projectId));
        throw new HTTPException(500, {
          message: "produce_step1_episodes workflow is not registered on this Mastra instance",
        });
      }

      const requestContext = new RequestContext();
      requestContext.set("cookie", fullCtx.cookie);
      requestContext.set("userId", fullCtx.userId);
      requestContext.set("projectId", fullCtx.projectId);
      if (fullCtx.worldId) requestContext.set("worldId", fullCtx.worldId);
      if (fullCtx.episodeId) requestContext.set("episodeId", fullCtx.episodeId);
      if (fullCtx.locale) requestContext.set("locale", fullCtx.locale);
      if (fullCtx.acceptLanguage) requestContext.set("acceptLanguage", fullCtx.acceptLanguage);
      if (fullCtx.dialogLanguage) requestContext.set("dialogLanguage", fullCtx.dialogLanguage);
      if (fullCtx.stylePainting) requestContext.set("stylePainting", fullCtx.stylePainting);
      if (typeof fullCtx.targetEpisodeCount === "number") {
        requestContext.set("targetEpisodeCount", fullCtx.targetEpisodeCount);
      }
      requestContext.set("runId", runId);

      try {
        const run = (await workflow.createRun({ runId })) as {
          start: (opts: { inputData: unknown; requestContext: RequestContext }) => Promise<unknown>;
        };
        const raw = await run.start({ inputData: input, requestContext });
        const r = (raw ?? {}) as { status?: string; result?: unknown; error?: unknown };
        if (clientCancelled) {
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          await getRedis().del(K.produceStep1Active(projectId));
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (r.status !== "success") {
          // Surface the deepest cause we can find — Mastra wraps step
          // failures so neither r.error nor r.result.error is always
          // populated; the actionable info lives on the failed step
          // entry in `r.steps[stepId]`.
          const detail = extractWorkflowFailureMessage(r);
          // Full result blob still goes to agent stdout for triage —
          // browser only sees the trimmed `detail` message.
          try {
            console.error(
              `[produce/step1] workflow failed runId=${runId}: ${detail}\n${JSON.stringify(r, null, 2).slice(0, 6000)}`
            );
          } catch {
            console.error(`[produce/step1] workflow failed runId=${runId}: ${detail}`);
          }
          await setStatus(runId, "failed", { error: detail });
          await getRedis().del(K.produceStep1Active(projectId));
          throw new HTTPException(500, { message: detail });
        }
        await setStatus(runId, "completed", { result: r.result });
        // Keep the active key set — the user still needs to /commit.
        // It clears on commit success (or on next /generate's runId
        // overwrite, naturally taking over).
        const draft = Step1OutputSchema.parse(r.result);
        return c.json({ runId, draft });
      } catch (err) {
        if (clientCancelled) {
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          await getRedis().del(K.produceStep1Active(projectId));
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (err instanceof HTTPException) throw err;
        const message = unwrapErrorChain(err);
        // Force the full error chain into stdout so the agent's
        // terminal shows the actual cause — Mastra's run.start()
        // wraps step throws in a generic "workflow failed" Error
        // whose `.cause` is the only place the real reason lives.
        console.error(`[produce/step1] run.start threw runId=${runId}: ${message}`, err);
        await setStatus(runId, "failed", { error: message });
        await getRedis().del(K.produceStep1Active(projectId));
        throw new HTTPException(500, { message });
      } finally {
        clientSignal?.removeEventListener("abort", onClientAbort);
      }
    },
  }),

  registerApiRoute("/produce/step2/generate", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = (await c.req.json()) as { projectId?: string; worldId?: string };
      const projectId = body.projectId ?? ctx.projectId;
      const worldId = body.worldId ?? ctx.worldId;
      if (projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      if (!worldId) {
        throw new HTTPException(400, { message: "worldId is required for step2/generate" });
      }
      const input = Step2InputSchema.parse({ projectId, worldId });

      const runId = randomUUID();
      const now = Date.now();
      await putMeta({
        runId,
        workflowName: "produce_step2_assets",
        workspaceId: projectId,
        userId: ctx.userId,
        status: "running",
        startedAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
      });
      await getRedis().set(K.produceStep2Active(projectId), runId, "EX", TTL.PRODUCE_DRAFT);

      const clientSignal = c.req.raw?.signal;
      let clientCancelled = false;
      const onClientAbort = () => {
        clientCancelled = true;
        void requestCancel(runId).catch((err) => {
          console.warn(
            `[produce/step2] requestCancel(${runId}) failed: ${err instanceof Error ? err.message : err}`
          );
        });
      };
      clientSignal?.addEventListener("abort", onClientAbort, { once: true });

      type MastraLike = {
        getWorkflowById: (
          name: string
        ) => { createRun: (opts: { runId: string }) => Promise<unknown> } | undefined;
      };
      const mastra = c.get("mastra" as never) as MastraLike | undefined;
      const workflow = mastra?.getWorkflowById("produce_step2_assets");
      if (!workflow) {
        await setStatus(runId, "failed", { error: "produce_step2_assets not registered" });
        await getRedis().del(K.produceStep2Active(projectId));
        throw new HTTPException(500, {
          message: "produce_step2_assets workflow is not registered on this Mastra instance",
        });
      }

      const requestContext = new RequestContext();
      requestContext.set("cookie", ctx.cookie);
      requestContext.set("userId", ctx.userId);
      requestContext.set("projectId", ctx.projectId);
      requestContext.set("worldId", worldId);
      if (ctx.locale) requestContext.set("locale", ctx.locale);
      if (ctx.acceptLanguage) requestContext.set("acceptLanguage", ctx.acceptLanguage);
      if (ctx.dialogLanguage) requestContext.set("dialogLanguage", ctx.dialogLanguage);
      requestContext.set("runId", runId);

      try {
        const run = (await workflow.createRun({ runId })) as {
          start: (opts: { inputData: unknown; requestContext: RequestContext }) => Promise<unknown>;
        };
        const raw = await run.start({ inputData: input, requestContext });
        const r = (raw ?? {}) as { status?: string; result?: unknown; error?: unknown };
        if (clientCancelled) {
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          await getRedis().del(K.produceStep2Active(projectId));
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (r.status !== "success") {
          const detail = extractWorkflowFailureMessage(r);
          try {
            console.error(
              `[produce/step2] workflow failed runId=${runId}: ${detail}\n${JSON.stringify(r, null, 2).slice(0, 6000)}`
            );
          } catch {
            console.error(`[produce/step2] workflow failed runId=${runId}: ${detail}`);
          }
          await setStatus(runId, "failed", { error: detail });
          await getRedis().del(K.produceStep2Active(projectId));
          throw new HTTPException(500, { message: detail });
        }
        await setStatus(runId, "completed", { result: r.result });
        const draft = Step2OutputSchema.parse(r.result);
        return c.json({ runId, draft });
      } catch (err) {
        if (clientCancelled) {
          await setStatus(runId, "cancelled", { error: "client disconnected" });
          await getRedis().del(K.produceStep2Active(projectId));
          return c.json({ runId, draft: null }, 499 as never);
        }
        if (err instanceof HTTPException) throw err;
        const message = unwrapErrorChain(err);
        console.error(`[produce/step2] run.start threw runId=${runId}: ${message}`, err);
        await setStatus(runId, "failed", { error: message });
        await getRedis().del(K.produceStep2Active(projectId));
        throw new HTTPException(500, { message });
      } finally {
        clientSignal?.removeEventListener("abort", onClientAbort);
      }
    },
  }),

  registerApiRoute("/produce/step2/commit", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = CommitRequestSchema.parse(await c.req.json());
      const meta = await getMeta(body.runId);
      if (!meta || meta.workflowName !== "produce_step2_assets") {
        throw new HTTPException(404, { message: "produce step2 draft not found" });
      }
      if (meta.status !== "completed") {
        throw new HTTPException(409, { message: `draft is not ready: ${meta.status}` });
      }
      const draft = Step2OutputSchema.parse(meta.result);
      if (draft.projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      const worldId = ctx.worldId ?? draft.worldId;
      if (!worldId) {
        throw new HTTPException(400, { message: "worldId required before committing assets" });
      }

      const commitKey = K.produceStep2Commit(ctx.projectId, body.runId);
      const existing = await readCommitState(commitKey);
      if (existing?.status === "completed" && existing.result) {
        return c.json({ ok: true, result: existing.result, reused: true });
      }
      if (existing?.status === "committing" && Date.now() - existing.startedAt < 10 * 60_000) {
        throw new HTTPException(409, { message: "commit already in progress" });
      }

      const state: CommitState = existing ?? {
        status: "committing",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await writeCommitState(commitKey, { ...state, status: "committing", updatedAt: Date.now() });

      try {
        const result = await commitStep2Draft({
          ctx: { ...ctx, worldId },
          runId: body.runId,
          draft,
        });
        await writeCommitState(commitKey, {
          ...state,
          status: "completed",
          updatedAt: Date.now(),
          result: result as ProduceCommitResult,
          error: undefined,
        });
        await getRedis().del(K.produceStep2Active(ctx.projectId));
        return c.json({ ok: true, result, reused: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeCommitState(commitKey, {
          ...state,
          status: "failed",
          updatedAt: Date.now(),
          error: message,
        });
        throw new HTTPException(500, { message });
      }
    },
  }),

  registerApiRoute("/produce/step1/commit", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = CommitRequestSchema.parse(await c.req.json());
      const meta = await getMeta(body.runId);
      if (!meta || meta.workflowName !== "produce_step1_episodes") {
        throw new HTTPException(404, { message: "produce step1 draft not found" });
      }
      if (meta.status !== "completed") {
        throw new HTTPException(409, { message: `draft is not ready: ${meta.status}` });
      }
      const draft = Step1OutputSchema.parse(meta.result);
      if (draft.projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }

      const commitKey = K.produceStep1Commit(ctx.projectId, body.runId);
      const existing = await readCommitState(commitKey);
      if (existing?.status === "completed" && existing.result) {
        // Idempotent: re-clicking 保存继续 returns the prior commit's
        // summary instead of re-writing Java. Important because the
        // upstream batch endpoints aren't fully idempotent on retry
        // (they re-upsert by sort key, not by id).
        return c.json({ ok: true, result: existing.result, reused: true });
      }
      if (existing?.status === "committing" && Date.now() - existing.startedAt < 10 * 60_000) {
        throw new HTTPException(409, { message: "commit already in progress" });
      }

      const state: CommitState = existing ?? {
        status: "committing",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await writeCommitState(commitKey, { ...state, status: "committing", updatedAt: Date.now() });

      try {
        const result = await commitStep1Draft({ ctx, draft });
        await writeCommitState(commitKey, {
          ...state,
          status: "completed",
          updatedAt: Date.now(),
          result: result as ProduceCommitResult, // schema is a subset of the legacy shape
          error: undefined,
        });
        // Active key is now obsolete — Step 1 is done; the next thing
        // the user does is move to /produce/asset, where Step 2 owns
        // its own active key.
        await getRedis().del(K.produceStep1Active(ctx.projectId));
        return c.json({ ok: true, result, reused: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeCommitState(commitKey, {
          ...state,
          status: "failed",
          updatedAt: Date.now(),
          error: message,
        });
        throw new HTTPException(500, { message });
      }
    },
  }),
];

async function readCommitState(key: string): Promise<CommitState | null> {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CommitState;
  } catch {
    return null;
  }
}

async function writeCommitState(key: string, state: CommitState): Promise<void> {
  await getRedis().set(key, JSON.stringify(state), "EX", TTL.PRODUCE_DRAFT);
}

/**
 * Step 1 commit — write episodes + scripts to Java, nothing else.
 * Sister of the legacy `commitProduceDraft` but stops after scripts;
 * assets and storyboards are committed by Step 2 and Step 3.
 *
 * Reuses `createEpisodes` and `saveScripts` from the legacy commit
 * path so both flows produce identical Java rows. The returned
 * shape mirrors `ProduceCommitResult` minus assets / shotCount, so
 * the page can render the same summary card across paths.
 */
async function commitStep1Draft(input: {
  ctx: StoryosContext;
  draft: import("zod").infer<typeof Step1OutputSchema>;
}): Promise<ProduceCommitResult> {
  const { ctx, draft } = input;
  const worldId = ctx.worldId ?? draft.worldId;
  if (!worldId) throw new Error("worldId required");
  const draftForCreate = {
    projectId: draft.projectId,
    episodes: draft.episodes,
  } as unknown as ProduceDraft;
  const episodeIds = await createEpisodes(ctx, draftForCreate);
  await saveScripts(ctx, draftForCreate, episodeIds);

  const episodes = draft.episodes.map((ep) => {
    const saved = episodeIds.find((item) => item.clientRefId === ep.clientRefId);
    if (!saved) throw new Error(`missing committed episode id for ${ep.title}`);
    return {
      clientRefId: ep.clientRefId,
      episodeId: saved.episodeId,
      no: ep.no,
      title: ep.title,
      scriptChars: ep.script.length,
      shotCount: 0,
    };
  });

  return {
    projectId: draft.projectId,
    worldId,
    title: draft.title,
    committedAt: Date.now(),
    episodes,
    assets: { characters: [], scenes: [], props: [] },
    totals: {
      episodeCount: episodes.length,
      characterCount: 0,
      sceneCount: 0,
      propCount: 0,
      shotCount: 0,
    },
  };
}

/**
 * Step 2 commit — write only the draft's NEW characters / scenes /
 * props. The workflow already filtered out names that match existing
 * Java rows during `extract_assets`, so this is a straight insert
 * pass; we keep dedup-by-name as a belt-and-braces check in case the
 * Java state changed between generate and commit.
 *
 * The shape returned mirrors `ProduceCommitResult` — empty episodes
 * list, populated assets, totals reflect the inserted-only counts.
 */
async function commitStep2Draft(input: {
  ctx: StoryosContext;
  runId: string;
  draft: import("zod").infer<typeof Step2OutputSchema>;
}): Promise<ProduceCommitResult> {
  const { ctx, runId, draft } = input;
  const worldId = ctx.worldId ?? draft.worldId;
  if (!worldId) throw new Error("worldId required");

  const stamp = (
    asset: { name: string; description: string; prompt: string },
    kind: string,
    i: number
  ) => ({
    clientRefId: `${runId}_${kind}_${i + 1}`,
    data: {
      worldId,
      name: asset.name,
      description: asset.description,
      prompt: asset.prompt || asset.description,
    },
  });

  const [roleResults, sceneResults, propResults] = await Promise.all([
    batchUpsertRoles(
      ctx,
      draft.characters.map((a, i) => stamp(a, "role", i)),
      { concurrency: 2 }
    ),
    batchUpsertScenes(
      ctx,
      draft.scenes.map((a, i) => stamp(a, "scene", i)),
      { concurrency: 2 }
    ),
    batchUpsertProps(
      ctx,
      draft.props.map((a, i) => stamp(a, "prop", i)),
      { concurrency: 2 }
    ),
  ]);

  assertBatchSuccess(roleResults, "角色");
  assertBatchSuccess(sceneResults, "场景");
  assertBatchSuccess(propResults, "道具");

  const characters = draft.characters.map((asset, i) => ({
    clientRefId: `${runId}_role_${i + 1}`,
    assetType: "role" as const,
    assetId: roleResults[i].serverId ?? "",
    name: asset.name,
    description: asset.description,
    prompt: asset.prompt || asset.description,
  }));
  const scenes = draft.scenes.map((asset, i) => ({
    clientRefId: `${runId}_scene_${i + 1}`,
    assetType: "scene" as const,
    assetId: sceneResults[i].serverId ?? "",
    name: asset.name,
    description: asset.description,
    prompt: asset.prompt || asset.description,
  }));
  const props = draft.props.map((asset, i) => ({
    clientRefId: `${runId}_prop_${i + 1}`,
    assetType: "prop" as const,
    assetId: propResults[i].serverId ?? "",
    name: asset.name,
    description: asset.description,
    prompt: asset.prompt || asset.description,
  }));

  return {
    projectId: draft.projectId,
    worldId,
    title: "",
    committedAt: Date.now(),
    episodes: [],
    assets: { characters, scenes, props },
    totals: {
      episodeCount: 0,
      characterCount: characters.length,
      sceneCount: scenes.length,
      propCount: props.length,
      shotCount: 0,
    },
  };
}

async function commitProduceDraft(input: {
  ctx: StoryosContext;
  runId: string;
  draft: ProduceDraft;
  state: CommitState;
  commitKey: string;
}): Promise<ProduceCommitResult> {
  const { ctx, draft, runId, commitKey } = input;
  const worldId = ctx.worldId;
  if (!worldId) throw new Error("worldId required");

  let episodeIds = input.state.episodeIds;
  if (!episodeIds?.length) {
    episodeIds = await createEpisodes(ctx, draft);
    await writeCommitState(commitKey, {
      ...input.state,
      status: "committing",
      updatedAt: Date.now(),
      episodeIds,
    });
  }

  await saveScripts(ctx, draft, episodeIds);
  const assets = await saveAssets(ctx, runId, draft, worldId);
  await saveStoryboards(ctx, draft, episodeIds);

  const episodes = draft.episodes.map((ep) => {
    const saved = episodeIds.find((item) => item.clientRefId === ep.clientRefId);
    if (!saved) throw new Error(`missing committed episode id for ${ep.title}`);
    return {
      clientRefId: ep.clientRefId,
      episodeId: saved.episodeId,
      no: ep.no,
      title: ep.title,
      scriptChars: ep.script.length,
      shotCount: ep.storyboardRows.length,
    };
  });

  return {
    projectId: draft.projectId,
    worldId,
    title: draft.title,
    committedAt: Date.now(),
    episodes,
    assets,
    totals: {
      episodeCount: episodes.length,
      characterCount: assets.characters.length,
      sceneCount: assets.scenes.length,
      propCount: assets.props.length,
      shotCount: episodes.reduce((sum, ep) => sum + ep.shotCount, 0),
    },
  };
}

async function createEpisodes(
  ctx: StoryosContext,
  draft: ProduceDraft
): Promise<Array<{ clientRefId: string; episodeId: string; title: string }>> {
  const datas = draft.episodes.map((ep, index) => ({
    title: ep.title,
    introduction: ep.introduction,
    frontPrompt: ep.frontPrompt || ep.introduction,
    behindPrompt: ep.behindPrompt || ep.introduction,
    projectId: draft.projectId,
    sort: (index + 1) * 1024,
  }));
  await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
    data: { datas },
    timeoutMs: 180_000,
  });
  const listed = await javaRequest<{
    list?: Array<{ id: string | number; title?: string; sort?: number }>;
  }>(ctx, "/api/user/world/list/episode", {
    data: { productId: draft.projectId, page: 1, pageSize: 999 },
    timeoutMs: 120_000,
  });
  const bySort = new Map((listed.list ?? []).map((ep) => [Number(ep.sort ?? 0), String(ep.id)]));
  return draft.episodes.map((ep, index) => {
    const episodeId = bySort.get((index + 1) * 1024);
    if (!episodeId) throw new Error(`episode id lookup missed for ${ep.title}`);
    return { clientRefId: ep.clientRefId, episodeId, title: ep.title };
  });
}

async function saveScripts(
  ctx: StoryosContext,
  draft: ProduceDraft,
  episodeIds: Array<{ clientRefId: string; episodeId: string }>
): Promise<void> {
  const ids = draft.episodes.map((ep) => {
    const saved = episodeIds.find((item) => item.clientRefId === ep.clientRefId);
    if (!saved) throw new Error(`missing episode id for script ${ep.title}`);
    return saved.episodeId;
  });
  const contents = draft.episodes.map((ep) => scriptToTiptapHtml(ep.script));
  await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/batch/createOrUpdate", {
    data: { projectId: draft.projectId, episodeIds: ids, contents },
    timeoutMs: 300_000,
  });
}

async function saveAssets(
  ctx: StoryosContext,
  runId: string,
  draft: ProduceDraft,
  worldId: string
): Promise<ProduceCommitResult["assets"]> {
  const roleResults = await batchUpsertRoles(
    ctx,
    draft.assets.characters.map((asset) => ({
      clientRefId: `${runId}_${asset.clientRefId}`,
      data: {
        worldId,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt || asset.description,
      },
    })),
    { concurrency: 2 }
  );
  const sceneResults = await batchUpsertScenes(
    ctx,
    draft.assets.scenes.map((asset) => ({
      clientRefId: `${runId}_${asset.clientRefId}`,
      data: {
        worldId,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt || asset.description,
      },
    })),
    { concurrency: 2 }
  );
  const propResults = await batchUpsertProps(
    ctx,
    draft.assets.props.map((asset) => ({
      clientRefId: `${runId}_${asset.clientRefId}`,
      data: {
        worldId,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt || asset.description,
      },
    })),
    { concurrency: 2 }
  );

  assertBatchSuccess(roleResults, "角色");
  assertBatchSuccess(sceneResults, "场景");
  assertBatchSuccess(propResults, "道具");

  return {
    characters: draft.assets.characters.map((asset, index) => ({
      clientRefId: asset.clientRefId,
      assetType: "role",
      assetId: roleResults[index].serverId ?? "",
      name: asset.name,
      description: asset.description,
      prompt: asset.prompt || asset.description,
    })),
    scenes: draft.assets.scenes.map((asset, index) => ({
      clientRefId: asset.clientRefId,
      assetType: "scene",
      assetId: sceneResults[index].serverId ?? "",
      name: asset.name,
      description: asset.description,
      prompt: asset.prompt || asset.description,
    })),
    props: draft.assets.props.map((asset, index) => ({
      clientRefId: asset.clientRefId,
      assetType: "prop",
      assetId: propResults[index].serverId ?? "",
      name: asset.name,
      description: asset.description,
      prompt: asset.prompt || asset.description,
    })),
  };
}

function assertBatchSuccess(
  results: Array<{ status: string; error?: string }>,
  label: string
): void {
  const failed = results.find((result) => result.status === "failed");
  if (failed) throw new Error(`${label}入库失败：${failed.error ?? "unknown error"}`);
}

async function saveStoryboards(
  ctx: StoryosContext,
  draft: ProduceDraft,
  episodeIds: Array<{ clientRefId: string; episodeId: string }>
): Promise<void> {
  const stylePainting = ctx.stylePainting ?? "";
  for (const ep of draft.episodes) {
    const saved = episodeIds.find((item) => item.clientRefId === ep.clientRefId);
    if (!saved) throw new Error(`missing episode id for storyboard ${ep.title}`);
    const rows = ep.storyboardRows.map((row, index) => [
      row.shot_no || String(index + 1),
      row.scene ?? "",
      row.description,
      row.image_prompt,
      row.video_prompt,
      stylePainting,
      row.movement,
      row.dialogue ?? "",
      row.shot_size,
      row.perspective,
      row.duration != null ? String(row.duration) : "",
    ]);
    await javaRequest<unknown>(ctx, "/api/ai/chat/save/storyboard", {
      data: {
        episodeId: saved.episodeId,
        datas: [STORYBOARD_HEADERS, ...rows],
        autoload: true,
      },
      timeoutMs: 300_000,
    });
  }
}

/**
 * Walk an Error chain (`.cause`, recursively) for the deepest message.
 * Mastra wraps step throws in a generic `Error("workflow failed")`
 * whose only useful info lives on `.cause`; if that itself is a
 * `WorkflowError`, the real cause chains one more deep. We stop on
 * the last non-empty `.message` we find.
 */
function unwrapErrorChain(err: unknown): string {
  let current: unknown = err;
  let best = "";
  let depth = 0;
  while (current && depth < 8) {
    if (current instanceof Error) {
      if (current.message && current.message !== "workflow failed") {
        best = current.message;
      } else if (!best && current.message) {
        best = current.message;
      }
      const cause = (current as Error & { cause?: unknown }).cause;
      if (!cause || cause === current) break;
      current = cause;
      depth += 1;
    } else if (typeof current === "string" && current.trim()) {
      best = current;
      break;
    } else {
      break;
    }
  }
  return best || (err instanceof Error ? err.message : String(err));
}

/**
 * Walk a Mastra workflow run result for the deepest actionable error
 * message. The shape Mastra returns on failure varies by version:
 *
 *   - sometimes top-level `error` is set to an Error instance,
 *   - sometimes only `result.error` holds the cause,
 *   - sometimes the failure is on a step inside `steps` / `stepResult`,
 *   - and sometimes `error` is undefined and only the `status` ===
 *     "failed" tells us anything is wrong.
 *
 * Falls through each shape in priority order and returns the most
 * specific string it finds. Generic fallback keeps callers from
 * crashing on the unknown variant.
 */
function extractWorkflowFailureMessage(r: {
  status?: string;
  result?: unknown;
  error?: unknown;
  steps?: unknown;
}): string {
  // Helper: pull a usable string out of `err`. Mastra serialises step
  // throws as plain `{message, name}` objects (Error instances don't
  // survive the JSON pipe), so we treat any object with a string
  // `.message` as a valid error source.
  const messageOf = (err: unknown): string | null => {
    if (!err) return null;
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string" && err.trim()) return err;
    if (typeof err === "object") {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m;
    }
    return null;
  };

  // 1. Top-level error (set by Mastra when the failure surfaces above
  //    any step boundary).
  const top = messageOf(r.error);
  if (top) return top;

  // 2. Failed step — Mastra puts step results under `r.steps[stepId]`
  //    (NOT inside `r.result.steps` like older versions). Fall back
  //    to that older shape too in case we land on a mixed bundle.
  const stepBuckets: Array<Record<string, unknown> | undefined> = [
    r.steps as Record<string, unknown> | undefined,
    (r.result as { steps?: Record<string, unknown> } | undefined)?.steps,
  ];
  for (const bucket of stepBuckets) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const [stepName, stepValue] of Object.entries(bucket)) {
      const step = stepValue as { status?: string; error?: unknown };
      if (step?.status !== "failed") continue;
      const stepMsg = messageOf(step.error);
      if (stepMsg) return `[${stepName}] ${stepMsg}`;
    }
  }

  // 3. Result-level error (older shape).
  const resultErr = messageOf((r.result as { error?: unknown } | undefined)?.error);
  if (resultErr) return resultErr;

  return `workflow ${r.status ?? "unknown"}`;
}

function scriptToTiptapHtml(text: string): string {
  const escaped = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escaped(line)}</p>`)
    .join("\n");
}
