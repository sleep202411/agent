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

// ─── Schemas ───────────────────────────────────────────────────────────

const EpisodeRef = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
  introduction: z.string().min(1),
});

export const ScriptPhaseInputSchema = z.object({
  projectId: z.string().min(1),
  episodes: z.array(EpisodeRef).min(1).max(60),
  storySummary: z.string().min(10),
  characters: z
    .array(z.object({ name: z.string(), role: z.string(), personality: z.string().optional() }))
    .default([]),
  genre: z.string().optional(),
  tone: z.string().optional(),
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

// ─── Step 1: generate scripts per episode ─────────────────────────────

const generateStep = createStep({
  id: "generate",
  inputSchema: ScriptPhaseInputSchema,
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
    "本集大纲：" + episode.introduction,
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
    const input = getInitData<z.infer<typeof ScriptPhaseInputSchema>>();
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
        data: { projectId: input.projectId, episodeIds, contents },
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
  description: "逐集生成剧本（长任务），HITL 确认后批量保存到剧集。",
  inputSchema: ScriptPhaseInputSchema,
  outputSchema: ScriptPhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(generateStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type ScriptPhaseOutput = z.infer<typeof ScriptPhaseOutputSchema>;
