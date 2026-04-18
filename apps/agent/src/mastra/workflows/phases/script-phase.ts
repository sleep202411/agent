/**
 * script_phase — for each episode, the scriptwriter persona produces a full
 * shootable script. Progress reported per-episode; one HITL gate at the end
 * lets the user confirm the whole batch before committing.
 *
 * This is the workflow's first truly long task. 20 episodes × ~15s/episode
 * ≈ 5 minutes. The worker process holds the run; if it restarts mid-way,
 * completed episodes are in state and already-written drafts stay in Redis.
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
import { getOutline } from "../../lib/outline";

// ─── Schemas ───────────────────────────────────────────────────────────

const EpisodeRef = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
  // Java's list/episode response sometimes omits introduction; allow empty
  // and fall back to storySummary when composing the prompt.
  introduction: z.string().default(""),
});

export const ScriptPhaseInputSchema = z.object({
  projectId: z.string().min(1),
  /** User feedback from revise round — sent to scriptwriter as guidance. */
  feedback: z.string().optional(),
});

/** Internal — resolved from skeleton + Java committed data. */
const ResolvedGenerateInputSchema = z.object({
  projectId: z.string(),
  episodes: z.array(EpisodeRef).min(1),
  storySummary: z.string(),
  characters: z
    .array(z.object({ name: z.string(), role: z.string(), personality: z.string().optional() }))
    .default([]),
  genre: z.string().optional(),
  tone: z.string().optional(),
  feedback: z.string().optional(),
});

export const ScriptPhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ episodeId: z.string(), title: z.string(), chars: z.number() })),
  failed: z.array(z.object({ episodeId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  generated: z
    .array(
      z.object({
        clientRefId: z.string(),
        episodeId: z.string(),
        title: z.string(),
        content: z.string(),
      })
    )
    .default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  totalChars: z.number(),
  phase: z.literal("script"),
});

// ─── Step 0: resolve inputs (from skeleton + Java episodes) ───────────

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: ScriptPhaseInputSchema,
  outputSchema: ResolvedGenerateInputSchema,
  execute: async ({ inputData, requestContext }) => {
    // requestContext is authoritative for projectId — LLM's guess may be wrong.
    const ctx = getContext(requestContext);
    const projectId = ctx.projectId;
    const record = await getOutline(projectId);
    if (!record) {
      throw new Error(
        `script_phase: no story outline cached for project ${projectId}. Run story_outline first.`
      );
    }
    const skeleton = record.outline;

    // Fetch committed episodes from Java — they must already be in DB.
    const listed = await javaRequest<{
      list?: Array<{
        id: string | number;
        title?: string;
        introduction?: string;
        sort?: number;
      }>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: projectId, page: 1, pageSize: 999 },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[script_phase] list/episode returned ${(listed.list ?? []).length} rows for project ${projectId}`
    );
    const episodes = (listed.list ?? [])
      .filter((ep) => ep.title)
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((ep) => ({
        episodeId: String(ep.id),
        title: String(ep.title),
        introduction: String(ep.introduction ?? ""),
      }));
    if (episodes.length === 0) {
      throw new Error(
        `script_phase: no committed episodes found for project ${projectId}. Run episode_phase first.`
      );
    }

    // Use committed roles from Java for personality hints (falls back to
    // skeleton cast arcs if Java doesn't have description fields).
    const listedRoles = await javaRequest<{
      list?: Array<{
        id?: string | number;
        name?: string;
        description?: string;
      }>;
    }>(ctx, "/api/user/world/list/worldrole", {
      data: { worldId: ctx.worldId ?? "", page: 1, pageSize: 999 },
    }).catch(() => ({ list: [] as Array<{ name?: string; description?: string }> }));
    const personalityByName = new Map<string, string>();
    for (const r of listedRoles.list ?? []) {
      if (r.name && r.description) {
        personalityByName.set(String(r.name), String(r.description));
      }
    }

    const characters = skeleton.cast.map((c) => ({
      name: c.name,
      role: c.role,
      personality: personalityByName.get(c.name) ?? c.arc,
    }));

    return {
      projectId: inputData.projectId,
      episodes,
      storySummary: skeleton.storySummary,
      characters,
      genre: skeleton.genre,
      tone: skeleton.tone,
      feedback: inputData.feedback,
    };
  },
});

// ─── Step 1: generate scripts per episode ─────────────────────────────

const generateStep = createStep({
  id: "generate",
  inputSchema: ResolvedGenerateInputSchema,
  outputSchema: z.object({ generatedCount: z.number(), totalChars: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const scriptwriter = mastra?.getAgent("scriptwriter");
    if (!scriptwriter) throw new Error("scriptwriter agent not registered");

    const total = inputData.episodes.length;
    const generated: z.infer<typeof StateSchema>["generated"] = [];
    let totalChars = 0;
    const castBlock = buildCastBlock(inputData.characters);

    await reportProgress(runId, {
      stepId: "script_phase.generate",
      current: 0,
      total,
      label: `编剧开始逐集写剧本（共 ${total} 集）`,
    });

    for (let i = 0; i < total; i++) {
      await throwIfCancelled(runId);
      const ep = inputData.episodes[i];

      const prompt = buildPrompt({
        index: i + 1,
        total,
        episode: ep,
        storySummary: inputData.storySummary,
        castBlock,
        genre: inputData.genre,
        tone: inputData.tone,
      });

      const response = await scriptwriter.generate(prompt, {
        structuredOutput: {
          schema: z.object({ content: z.string().min(50) }),
          errorStrategy: "warn",
        },
      });
      const obj = response.object as { content?: string } | undefined;
      const content = (obj?.content ?? response.text ?? "").trim();

      if (!content) {
        // Skip — mark as generated with empty content; commit step will fail it loudly.
        generated.push({
          clientRefId: randomUUID(),
          episodeId: ep.episodeId,
          title: ep.title,
          content: "",
        });
      } else {
        const clientRefId = randomUUID();
        await putDraft(runId, "script", clientRefId, {
          episodeId: ep.episodeId,
          title: ep.title,
          content,
        });
        generated.push({ clientRefId, episodeId: ep.episodeId, title: ep.title, content });
        totalChars += content.length;
      }

      await reportProgress(runId, {
        stepId: "script_phase.generate",
        current: i + 1,
        total,
        label: `已生成 ${i + 1}/${total} 集（${totalChars} 字）`,
      });
    }

    setState({ generated });
    return { generatedCount: generated.length, totalChars };
  },
});

function buildCastBlock(
  characters: { name: string; role: string; personality?: string }[]
): string {
  if (characters.length === 0) return "";
  const lines = characters.map(
    (c) => `- **${c.name}**（${c.role}）${c.personality ? ` — ${c.personality.slice(0, 80)}` : ""}`
  );
  return `\n角色清单（对白和动作要符合各自性格）：\n${lines.join("\n")}\n`;
}

function buildPrompt(args: {
  index: number;
  total: number;
  episode: z.infer<typeof EpisodeRef>;
  storySummary: string;
  castBlock: string;
  genre?: string;
  tone?: string;
}): string {
  const { index, total, episode, storySummary, castBlock, genre, tone } = args;
  const meta = [genre ? `类型：${genre}` : "", tone ? `基调：${tone}` : ""]
    .filter(Boolean)
    .join(" / ");

  return [
    `请为第 ${index}/${total} 集写完整的可拍摄剧本。`,
    meta,
    "",
    "故事主线：",
    storySummary,
    castBlock,
    "本集标题：" + episode.title,
    episode.introduction ? "本集大纲：" + episode.introduction : "",
    "",
    "要求：",
    '- 格式：每场戏以"场景 N: 地点 - 时间"开头',
    '- 每个角色的台词标注"角色：台词内容"',
    "- 动作 / 表情 / 环境描写单独成行，用中文标点",
    "- 长度：300-800 字；不要灌水，密度高",
    "- 结尾留一个钩子（未解之谜 / 反转信号 / 情绪张力）",
    "",
    "以 JSON 返回，字段 content 就是完整剧本文本。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Step 2: HITL ─────────────────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ generatedCount: z.number(), totalChars: z.number() }),
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
        stepId: "script_phase.confirm",
        current: inputData.generatedCount,
        total: inputData.generatedCount,
        label: `已生成 ${inputData.generatedCount} 集剧本（${inputData.totalChars} 字），等待确认`,
      });
      return await suspend({
        runId,
        episodeCount: inputData.generatedCount,
        totalChars: inputData.totalChars,
        phase: "script" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 3: commit via batchSaveScripts ──────────────────────────────

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: ScriptPhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const rawInput = getInitData<z.infer<typeof ScriptPhaseInputSchema>>();
    const projectId = rawInput.projectId || ctx.projectId;
    const generated = state.generated ?? [];

    if (!inputData.approved) {
      for (const g of generated) await markDraftDiscarded(runId, g.clientRefId);
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `剧本阶段未通过。反馈：${inputData.feedback}`
          : "剧本阶段未通过。",
      };
    }

    const accepted = inputData.acceptedClientRefIds
      ? new Set(inputData.acceptedClientRefIds)
      : null;
    const drafts = await listDrafts<{ episodeId: string; title: string; content: string }>(runId, {
      entityType: "script",
      statuses: ["pending"],
    });
    const accepts = drafts.filter((d) => !accepted || accepted.has(d.clientRefId));

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

    await reportProgress(runId, {
      stepId: "script_phase.commit",
      current: 0,
      total: accepts.length,
      label: `批量保存 ${accepts.length} 集剧本…`,
    });

    const committed: z.infer<typeof ScriptPhaseOutputSchema>["committed"] = [];
    const failed: z.infer<typeof ScriptPhaseOutputSchema>["failed"] = [];

    const episodeIds = accepts.map((d) => d.data.episodeId);
    const contents = accepts.map((d) => d.data.content);

    try {
      await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/batch/createOrUpdate", {
        data: { projectId, episodeIds, contents },
        timeoutMs: 300_000,
      });
      for (const d of accepts) {
        await markDraftCommitted(runId, d.clientRefId, d.data.episodeId);
        committed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          chars: d.data.content.length,
        });
      }
      await deleteAllDrafts(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Java's batch endpoint is all-or-nothing — mark everything as failed.
      for (const d of accepts) {
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          reason: message,
        });
      }
    }

    const outcome: z.infer<typeof ScriptPhaseOutputSchema>["outcome"] =
      failed.length === 0 ? "committed" : "partial_failure";

    await reportProgress(runId, {
      stepId: "script_phase.commit",
      current: committed.length,
      total: accepts.length,
      label: `剧本保存完成：成功 ${committed.length} / 失败 ${failed.length}`,
    });

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已保存 ${committed.length} 集剧本，进入下一阶段。`
          : `保存失败：${failed.length} / ${accepts.length}。剧本草稿保留在 Redis 供重试。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptPhaseWorkflow = createWorkflow({
  id: "script_phase",
  description:
    "剧本阶段：按集调用编剧 → 长任务生成剧本 → HITL → 批量保存。支持 fromProjectOutline 自动读骨架 + 已入库分集。",
  inputSchema: ScriptPhaseInputSchema,
  outputSchema: ScriptPhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(generateStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type ScriptPhaseOutput = z.infer<typeof ScriptPhaseOutputSchema>;
