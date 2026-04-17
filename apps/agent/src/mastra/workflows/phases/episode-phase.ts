/**
 * episode_phase — plan N episodes from a story outline via the episode-planner
 * persona, HITL-confirm, then batch upsert to Java.
 *
 * Java endpoint `/api/user/world/batch/updateOrAdd/episode` is already in
 * production and accepts a list of {title, introduction, frontPrompt,
 * behindPrompt, sort, projectId} entries. We use it directly — no BatchWriter
 * wrapper yet because episode inserts don't need idempotency keys (Java's
 * own sort-based merge handles duplicates).
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  deleteAllDrafts,
  listDrafts,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  putDraft,
} from "../../lib/drafts";
import { reportProgress, throwIfCancelled } from "../engine";
import { getContext, javaRequest } from "../../lib/workspace-client";

// ─── Schemas ───────────────────────────────────────────────────────────

const EpisodePlan = z.object({
  title: z.string().min(1).max(30),
  introduction: z.string().min(30).max(400),
  frontPrompt: z.string().optional(),
  behindPrompt: z.string().optional(),
});

export const EpisodePhaseInputSchema = z.object({
  projectId: z.string().min(1),
  storySummary: z.string().min(10),
  characters: z.array(z.object({ name: z.string(), role: z.string() })).default([]),
  targetEpisodeCount: z.number().int().min(1).max(60),
  genre: z.string().optional(),
  tone: z.string().optional(),
});

export const EpisodePhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(
    z.object({ clientRefId: z.string(), serverId: z.string(), title: z.string() })
  ),
  failed: z.array(z.object({ clientRefId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  plannedEpisodes: z.array(EpisodePlan).default([]),
  draftClientRefIds: z.array(z.string()).default([]),
  titleByRef: z.record(z.string(), z.string()).default({}),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  phase: z.literal("episode"),
});

// ─── Step 1: plan episodes (LLM) ──────────────────────────────────────

const planStep = createStep({
  id: "plan",
  inputSchema: EpisodePhaseInputSchema,
  outputSchema: z.object({ done: z.literal(true) }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, state, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    await reportProgress(runId, {
      stepId: "episode_phase.plan",
      current: 0,
      total: inputData.targetEpisodeCount,
      label: "分集策划师正在规划分集…",
    });

    const planner = mastra?.getAgent("episodePlanner");
    if (!planner) throw new Error("episode-planner agent not registered");

    const prompt = buildPrompt(inputData);
    const response = await planner.generate(prompt, {
      structuredOutput: {
        schema: z.object({ episodes: z.array(EpisodePlan) }),
        errorStrategy: "warn",
      },
    });
    const episodes = (
      (response.object as { episodes?: z.infer<typeof EpisodePlan>[] } | undefined)?.episodes ?? []
    ).slice(0, inputData.targetEpisodeCount);

    if (episodes.length === 0) {
      throw new Error("episode-planner produced no episodes");
    }

    setState({ ...state, plannedEpisodes: episodes });
    await reportProgress(runId, {
      stepId: "episode_phase.plan",
      current: episodes.length,
      total: inputData.targetEpisodeCount,
      label: `规划 ${episodes.length} 集大纲完成`,
    });
    return { done: true as const };
  },
});

function buildPrompt(input: z.infer<typeof EpisodePhaseInputSchema>): string {
  const cast = input.characters.map((c) => `- ${c.name}（${c.role}）`).join("\n");
  const parts = [
    `目标集数：${input.targetEpisodeCount}`,
    input.genre ? `类型：${input.genre}` : "",
    input.tone ? `基调：${input.tone}` : "",
    "",
    "故事主线：",
    input.storySummary,
    "",
    cast ? `角色清单：\n${cast}` : "",
    "",
    `请输出严格 ${input.targetEpisodeCount} 集的分集大纲，JSON 数组 episodes 返回。`,
  ].filter(Boolean);
  return parts.join("\n");
}

// ─── Step 2: collect drafts ───────────────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: z.object({ done: z.literal(true) }),
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ state, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const planned = state.plannedEpisodes ?? [];
    const draftClientRefIds: string[] = [];
    const titleByRef: Record<string, string> = {};
    let i = 0;
    for (const ep of planned) {
      const clientRefId = randomUUID();
      // Store the full planned shape — commit step will send to Java.
      await putDraft(runId, "episode", clientRefId, {
        title: ep.title,
        introduction: ep.introduction,
        frontPrompt: ep.frontPrompt ?? "",
        behindPrompt: ep.behindPrompt ?? "",
        sortHint: i,
      });
      draftClientRefIds.push(clientRefId);
      titleByRef[clientRefId] = ep.title;
      i += 1;
      await reportProgress(runId, {
        stepId: "episode_phase.collect",
        current: i,
        total: planned.length,
        label: `已收集 ${i}/${planned.length} 集草稿`,
      });
    }
    setState({ ...state, draftClientRefIds, titleByRef });
    return { draftCount: draftClientRefIds.length };
  },
});

// ─── Step 3: HITL ─────────────────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ draftCount: z.number() }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  stateSchema: StateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "episode_phase.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} 集大纲已生成，等待确认`,
      });
      return await suspend({
        runId,
        episodeCount: inputData.draftCount,
        phase: "episode" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 4: commit ───────────────────────────────────────────────────

const SORT_GAP = 1024;

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: EpisodePhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const input = getInitData<z.infer<typeof EpisodePhaseInputSchema>>();
    const draftClientRefIds = state.draftClientRefIds ?? [];
    const titleByRef = state.titleByRef ?? {};

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `分集阶段未通过。反馈：${inputData.feedback}`
          : "分集阶段未通过。",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<{
      title: string;
      introduction: string;
      frontPrompt: string;
      behindPrompt: string;
      sortHint: number;
    }>(runId, { entityType: "episode", statuses: ["pending"] });
    const accepts = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .sort((a, b) => a.data.sortHint - b.data.sortHint);

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);
    await reportProgress(runId, {
      stepId: "episode_phase.commit",
      current: 0,
      total: accepts.length,
      label: `入库 ${accepts.length} 集…`,
    });

    // Java's batch/updateOrAdd/episode expects one payload with `datas` array.
    const datas = accepts.map((d, idx) => ({
      title: d.data.title,
      introduction: d.data.introduction,
      frontPrompt: d.data.frontPrompt,
      behindPrompt: d.data.behindPrompt,
      projectId: input.projectId,
      sort: (idx + 1) * SORT_GAP,
    }));

    const committed: z.infer<typeof EpisodePhaseOutputSchema>["committed"] = [];
    const failed: z.infer<typeof EpisodePhaseOutputSchema>["failed"] = [];

    try {
      await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
        data: { datas },
        timeoutMs: 120_000,
      });
      // Java doesn't return ids; re-list and match by sort.
      const listed = await javaRequest<{ list?: Array<{ id: string | number; sort?: number }> }>(
        ctx,
        "/api/user/world/list/episode",
        { data: { productId: input.projectId, page: 1, pageSize: 999 } }
      );
      const bySort = new Map(
        (listed.list ?? []).map((ep) => [Number(ep.sort ?? 0), String(ep.id)])
      );
      for (let i = 0; i < accepts.length; i++) {
        const d = accepts[i];
        const sortKey = (i + 1) * SORT_GAP;
        const serverId = bySort.get(sortKey);
        if (serverId) {
          await markDraftCommitted(runId, d.clientRefId, serverId);
          committed.push({
            clientRefId: d.clientRefId,
            serverId,
            title: titleByRef[d.clientRefId] ?? d.data.title,
          });
        } else {
          await markDraftFailed(runId, d.clientRefId, "Java write succeeded but id lookup missed");
          failed.push({
            clientRefId: d.clientRefId,
            title: titleByRef[d.clientRefId] ?? d.data.title,
            reason: "id lookup missed",
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const d of accepts) {
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          clientRefId: d.clientRefId,
          title: titleByRef[d.clientRefId] ?? d.data.title,
          reason: message,
        });
      }
    }

    const outcome: z.infer<typeof EpisodePhaseOutputSchema>["outcome"] =
      failed.length === 0
        ? "committed"
        : committed.length === 0
          ? "partial_failure"
          : "partial_failure";

    if (failed.length === 0) await deleteAllDrafts(runId);

    await reportProgress(runId, {
      stepId: "episode_phase.commit",
      current: committed.length,
      total: accepts.length,
      label: `分集入库：成功 ${committed.length} / 失败 ${failed.length}`,
    });

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已入库 ${committed.length} 集，进入下一阶段。`
          : `入库有失败：${failed.length} / ${accepts.length}`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const episodePhaseWorkflow = createWorkflow({
  id: "episode_phase",
  description: "根据故事主线生成分集大纲 → HITL → 批量入库 episode。",
  inputSchema: EpisodePhaseInputSchema,
  outputSchema: EpisodePhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(planStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type EpisodePhaseOutput = z.infer<typeof EpisodePhaseOutputSchema>;
