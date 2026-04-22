/**
 * script_phase — for each episode, the scriptwriter persona produces a full
 * shootable script. Emits drafts for review, then ends. Commit via
 * `applyScriptDrafts()`.
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
import { getContext, javaRequest, type StoryosContext } from "../../lib/workspace-client";
import { getOutline } from "../../lib/outline";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";

// ─── Schemas ───────────────────────────────────────────────────────────

const EpisodeRef = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
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
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
});

interface ScriptDraftData {
  episodeId: string;
  title: string;
  content: string;
  projectId: string;
}

// ─── Step 0: resolve inputs ────────────────────────────────────────────

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: ScriptPhaseInputSchema,
  outputSchema: ResolvedGenerateInputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const projectId = ctx.projectId;
    const record = await getOutline(projectId);
    if (!record) {
      throw new Error(
        `script_phase: no story outline cached for project ${projectId}. Run story_outline first.`
      );
    }
    const skeleton = record.outline;

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

const GEN_CONCURRENCY = 4;

const generateStep = createStep({
  id: "generate",
  inputSchema: ResolvedGenerateInputSchema,
  outputSchema: z.object({ generatedCount: z.number(), totalChars: z.number() }),
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const scriptwriter = mastra?.getAgent("scriptwriter");
    if (!scriptwriter) throw new Error("scriptwriter agent not registered");

    const ctx = getContext(requestContext);
    const dialogLanguage = ctx.dialogLanguage;

    const total = inputData.episodes.length;
    let totalChars = 0;
    let completed = 0;
    const castBlock = buildCastBlock(inputData.characters);

    const startLabel = `编剧开始逐集写剧本（共 ${total} 集）`;
    await reportProgress(runId, {
      stepId: "script_phase.generate",
      current: 0,
      total,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "script_phase", "planning", {
      current: 0,
      total,
      label: startLabel,
    });

    const CONCURRENCY = Math.min(GEN_CONCURRENCY, total);
    let cursor = 0;

    const runOne = async (i: number) => {
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
        dialogLanguage,
      });

      const response = await scriptwriter.generate(prompt, {
        structuredOutput: {
          schema: z.object({ content: z.string().min(50) }),
          errorStrategy: "warn",
        },
      });
      const obj = response.object as { content?: string } | undefined;
      const content = (obj?.content ?? response.text ?? "").trim();

      if (content) {
        const clientRefId = randomUUID();
        const data: ScriptDraftData = {
          episodeId: ep.episodeId,
          title: ep.title,
          content,
          projectId: inputData.projectId,
        };
        await putDraft(runId, "script", clientRefId, data);
        totalChars += content.length;
      }

      completed += 1;
      const label = `已生成 ${completed}/${total} 集（${totalChars} 字）`;
      await reportProgress(runId, {
        stepId: "script_phase.generate",
        current: completed,
        total,
        label,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "script_phase", "planning", {
        current: completed,
        total,
        label,
      });
    };

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) return;
        await runOne(i);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const committedDrafts = await listDrafts(runId, {
      entityType: "script",
      statuses: ["pending"],
    });
    return { generatedCount: committedDrafts.length, totalChars };
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

function scriptToTiptapHtml(text: string): string {
  if (!text) return "";
  const escaped = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escaped(line)}</p>`);
  if (paragraphs.length === 0) return "";
  return paragraphs.join("\n");
}

function dialogLanguageLabel(code: string | undefined): string {
  switch (code) {
    case "zh-CN":
      return "简体中文";
    case "zh-HK":
      return "繁体中文";
    case "en-US":
      return "English";
    default:
      return code || "简体中文";
  }
}

function buildPrompt(args: {
  index: number;
  total: number;
  episode: z.infer<typeof EpisodeRef>;
  storySummary: string;
  castBlock: string;
  genre?: string;
  tone?: string;
  dialogLanguage?: string;
}): string {
  const { index, total, episode, storySummary, castBlock, genre, tone, dialogLanguage } = args;
  const meta = [genre ? `类型：${genre}` : "", tone ? `基调：${tone}` : ""]
    .filter(Boolean)
    .join(" / ");
  const langLabel = dialogLanguageLabel(dialogLanguage);

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
    `- **全部台词与旁白用${langLabel}**（场景标题、动作描写可保持中文框架，对白严格按此语言）`,
    "- 格式按拍摄本风格，**每个原子段落独占一行（用 \\n 真实换行分隔）**，不要把整集挤成一大段",
    '  - 场景标题独占一行："场景 N: 地点 - 时间"',
    '  - 每句角色台词独占一行："角色：台词内容"',
    "  - 每个动作 / 表情 / 环境描写独占一行",
    '  - 旁白 / 画外音独占一行，用"（旁白）"或"V.O."前缀',
    "- 长度：300-800 字；不要灌水，密度高",
    "- 结尾留一个钩子（未解之谜 / 反转信号 / 情绪张力）",
    "",
    "以 JSON 返回，字段 content 是完整剧本文本（里面必须包含真实换行，用 \\n 连接各行）。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Step 2: emit awaiting-review + end ───────────────────────────────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ generatedCount: z.number(), totalChars: z.number() }),
  outputSchema: ScriptPhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    await reportProgress(runId, {
      stepId: "script_phase.review",
      current: inputData.generatedCount,
      total: inputData.generatedCount,
      label: `已生成 ${inputData.generatedCount} 集剧本（${inputData.totalChars} 字），等待确认`,
    });

    const drafts = await listDrafts<ScriptDraftData>(runId, {
      entityType: "script",
      statuses: ["pending"],
    });
    await publishWorkflowSuspended(ctx.projectId, runId, "script_phase", {
      draftGroups: [
        {
          entityType: "script",
          count: drafts.length,
          items: drafts.map((d) => ({
            clientRefId: d.clientRefId,
            data: d.data as unknown as Record<string, unknown>,
          })),
        },
      ],
      totalDraftCount: drafts.length,
      estimatedCost: drafts.length * PRICES.scriptPerEpisode,
    });

    return {
      runId,
      draftCount: inputData.generatedCount,
      message: `已生成 ${inputData.generatedCount} 集剧本草稿，等待确认。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptPhaseWorkflow = createWorkflow({
  id: "script_phase",
  description:
    "剧本阶段：按集调用编剧生成剧本 → 草稿入 Redis → 等用户确认。确认后走 apply_phase_drafts 批量保存。",
  inputSchema: ScriptPhaseInputSchema,
  outputSchema: ScriptPhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(generateStep)
  .then(emitReviewStep)
  .commit();

// ─── Apply helper ──────────────────────────────────────────────────────

export interface ApplyScriptDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
}

export interface ApplyScriptDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
}

export async function applyScriptDrafts(
  opts: ApplyScriptDraftsOptions
): Promise<ApplyScriptDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  await throwIfCancelled(runId);

  const pending = await listDrafts<ScriptDraftData>(runId, {
    entityType: "script",
    statuses: ["pending"],
  });
  const pendingRefIds = pending.map((d) => d.clientRefId);
  const projectId = pending[0]?.data.projectId ?? ctx.projectId;

  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.scriptPerEpisode,
      reason: `script_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "script_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    await publishWorkflowFailed(ctx.projectId, runId, "script_phase", {
      terminalStatus: "cancelled",
      error: feedback ? `用户要求修改：${feedback}` : "用户未通过。",
      retryable: false,
    });
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `剧本阶段未通过。反馈：${feedback}` : "剧本阶段未通过。",
    };
  }

  const accepted = acceptedClientRefIds ? new Set(acceptedClientRefIds) : null;
  const accepts = pending.filter((d) => !accepted || accepted.has(d.clientRefId));

  for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `批量保存 ${accepts.length} 集剧本…`;
  await reportProgress(runId, {
    stepId: "script_phase.commit",
    current: 0,
    total: accepts.length,
    label: startLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "script_phase", "committing", {
    current: 0,
    total: accepts.length,
    label: startLabel,
  });

  const committed: Array<{ episodeId: string; title: string; chars: number }> = [];
  const failed: Array<{ episodeId: string; title: string; reason: string }> = [];

  const episodeIds = accepts.map((d) => d.data.episodeId);
  const contents = accepts.map((d) => scriptToTiptapHtml(d.data.content));

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
    for (const d of accepts) {
      await markDraftFailed(runId, d.clientRefId, message);
      failed.push({
        episodeId: d.data.episodeId,
        title: d.data.title,
        reason: message,
      });
    }
  }

  const outcome = failed.length === 0 ? ("committed" as const) : ("partial_failure" as const);

  const endLabel = `剧本保存完成：成功 ${committed.length} / 失败 ${failed.length}`;
  await reportProgress(runId, {
    stepId: "script_phase.commit",
    current: committed.length,
    total: accepts.length,
    label: endLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "script_phase", "committing", {
    current: committed.length,
    total: accepts.length,
    label: endLabel,
  });

  const summaryText =
    outcome === "committed"
      ? `已保存 ${committed.length} 集剧本，进入下一阶段。`
      : `保存失败：${failed.length} / ${accepts.length}。剧本草稿保留在 Redis 供重试。`;

  await publishWorkflowCompleted(ctx.projectId, runId, "script_phase", {
    committed: committed.map((c) => ({ serverId: c.episodeId, title: c.title })),
    failed: failed.map((f) => ({ clientRefId: f.episodeId, reason: f.reason })),
    summary: summaryText,
    nextSteps: [
      {
        workflowName: "storyboard_phase",
        labelKey: "workflowNextContinueToStoryboard",
        variant: "primary",
      },
    ],
  });

  return {
    outcome,
    committedCount: committed.length,
    failedCount: failed.length,
    message: summaryText,
  };
}
