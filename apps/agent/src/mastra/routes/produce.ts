/**
 * Produce-mode routes.
 *
 * These routes are deliberately separate from StoryOS chat and the legacy
 * phase workflow API. Step 1 creates an ephemeral analysis draft; only the
 * explicit commit route writes Java business data.
 */
import { registerApiRoute } from "@mastra/core/server";
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
import {
  getMeta,
  getQueue,
  recordHeartbeat,
  requestCancel,
  setStatus,
  startWorkflow,
} from "../workflows/engine";
import {
  ProducePipelineInputSchema,
  ProducePipelineOutputSchema,
} from "../workflows/produce-script-pipeline";

const CommitRequestSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  worldId: z.string().min(1).optional(),
});

const StartRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  worldId: z.string().min(1).optional(),
  seed: ProducePipelineInputSchema.shape.seed,
});

const StatusRequestSchema = z.object({
  runId: z.string().min(1),
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
  registerApiRoute("/produce/script-draft/start", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const body = StartRequestSchema.parse(await c.req.json());
      const projectId = body.projectId ?? ctx.projectId;
      if (projectId !== ctx.projectId) {
        throw new HTTPException(403, { message: "projectId does not match auth context" });
      }
      const worldId = body.worldId ?? body.seed.worldId ?? ctx.worldId;
      const input = ProducePipelineInputSchema.parse({
        projectId,
        worldId,
        seed: { ...body.seed, worldId },
      });
      const { runId } = await startWorkflow({
        workflowName: "produce_script_pipeline",
        inputData: input,
        ctx: {
          ...ctx,
          projectId,
          worldId,
          targetEpisodeCount: body.seed.episodeCount,
          dialogLanguage: body.seed.language,
        },
      });
      return c.json({ runId, status: "queued" });
    },
  }),

  registerApiRoute("/produce/script-draft/status", {
    method: "POST",
    handler: async (c) => {
      requireContext(c);
      const { runId } = StatusRequestSchema.parse(await c.req.json());
      const meta = await getMeta(runId);
      if (!meta || meta.workflowName !== "produce_script_pipeline") {
        throw new HTTPException(404, { message: "produce run not found" });
      }
      if (meta.status === "queued" || meta.status === "running") {
        await recordHeartbeat(runId);
      }
      return c.json({
        runId,
        status: meta.status,
        progress: meta.progress,
        error: meta.error,
        errorClassification: meta.errorClassification,
        result: meta.result ?? null,
        startedAt: meta.startedAt,
        updatedAt: meta.updatedAt,
        completedAt: meta.completedAt,
      });
    },
  }),

  registerApiRoute("/produce/script-draft/cancel", {
    method: "POST",
    handler: async (c) => {
      requireContext(c);
      const { runId } = StatusRequestSchema.parse(await c.req.json());
      const meta = await getMeta(runId);
      if (!meta || meta.workflowName !== "produce_script_pipeline") {
        return c.json({ ok: true });
      }
      if (meta.status !== "completed" && meta.status !== "failed" && meta.status !== "cancelled") {
        await requestCancel(runId);
        await setStatus(runId, "cancelled");
        await removeWaitingJobs(runId);
      }
      return c.json({ ok: true });
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
];

async function removeWaitingJobs(runId: string): Promise<void> {
  try {
    const queue = getQueue();
    const initial = await queue.getJob(`run-${runId}`);
    if (initial) {
      const state = await initial.getState();
      if (state === "waiting" || state === "delayed") await initial.remove();
    }
  } catch (err) {
    console.warn(
      `[produce] removeWaitingJobs failed runId=${runId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

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
