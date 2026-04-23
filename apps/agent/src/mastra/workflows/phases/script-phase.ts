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
import { publishEntityEvent } from "../../lib/entity-events";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import type { WorkflowCompletedOutput, WorkflowFailedOutput } from "@repo/shared";

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
  /**
   * Episode ids to write scripts for. When omitted, script_phase falls back
   * to "every committed episode in the project" — fine for clean projects
   * but wrong after multiple episode_phase runs accumulate history. The
   * episode_phase completion card sets this to just-committed ids so
   * Continue·Generate scripts only covers THIS batch, not every past
   * episode in Java.
   */
  episodeIds: z.array(z.string()).optional(),
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
    const allEpisodes = (listed.list ?? [])
      .filter((ep) => ep.title)
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((ep) => ({
        episodeId: String(ep.id),
        title: String(ep.title),
        introduction: String(ep.introduction ?? ""),
      }));
    // Narrow to the caller-specified episode ids when present (this is how
    // the episode_phase Continue button scopes the batch). Fall back to
    // "all episodes" only when no ids were passed (useful for manual
    // workflow-level invocations / reruns / script regen).
    const requestedIds = new Set(inputData.episodeIds ?? []);
    const episodes =
      requestedIds.size > 0
        ? allEpisodes.filter((ep) => requestedIds.has(ep.episodeId))
        : allEpisodes;
    // eslint-disable-next-line no-console
    console.log(
      `[script_phase] project=${projectId} episodes total=${allEpisodes.length} requested=${requestedIds.size || "all"} writing=${episodes.length}`
    );
    if (episodes.length === 0) {
      throw new Error(
        requestedIds.size > 0
          ? `script_phase: none of the requested episode ids (${inputData.episodeIds?.join(", ")}) match Java's episode list for project ${projectId}.`
          : `script_phase: no committed episodes found for project ${projectId}. Run episode_phase first.`
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
    `请为第 ${index}/${total} 集写完整的可拍摄短剧剧本。`,
    meta,
    "",
    "故事主线：",
    storySummary,
    castBlock,
    "本集标题：" + episode.title,
    episode.introduction ? "本集大纲：" + episode.introduction : "",
    "",
    "要求：",
    `- **全部台词与旁白用${langLabel}**（画面描述、音效提示可用中文框架；对白严格按此语言）`,
    `- 按 persona 里"时间码拍摄本格式"严格输出：首行集标题，之后按 \`0:00-0:15\` 等时码分段，每段内\`【画面】\` / \`【音效/环境】\` / 角色台词 各独占一行`,
    "- 总时长 1-3 分钟，通常切 4-8 个时间段，每段 10-30 秒对应 30-150 字",
    "- 第 1 段 15 秒必须锚定场景 + 抛钩子；末段强 cliffhanger",
    "- 每集至少 1 个标志性画面（特写 / 对视 / 道具慢镜）",
    "- 音效拟声词用大写（TINKS / RUSTLES / KNOCKS 等），营造氛围",
    "- 台词必须有潜台词 + 推动剧情/揭示角色/制造冲突（三不沾删掉）",
    "",
    '以 JSON 返回：\`{"content": "...剧本全文，真实换行用 \\\\n..."}\`。不要 Markdown 代码块、不要前言。',
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
  /** See role-phase.applyRoleDrafts for rationale. */
  emitLifecycleMessage?: boolean;
}

export interface ApplyScriptDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

export async function applyScriptDrafts(
  opts: ApplyScriptDraftsOptions
): Promise<ApplyScriptDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
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
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "script_phase",
      terminalStatus: "cancelled",
      error: feedback ? `用户要求修改：${feedback}` : "用户未通过。",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "script_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `剧本阶段未通过。反馈：${feedback}` : "剧本阶段未通过。",
      completion: null,
      failure: failurePayload,
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

  if (committed.length > 0) {
    await publishEntityEvent(ctx, {
      entity: "script",
      action: "batch_created",
      source: "script_phase",
    });
  }

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

  // Total failure (0 committed, all failed) = the phase failed, not just
  // "partial done". Emitting a completion card with a misleading "Continue
  // to storyboard" next-step would invite the user to proceed on top of
  // zero data. Route through the failed-card path instead so the user
  // gets a Retry affordance and no false "continue" option.
  const totalFailure = committed.length === 0 && failed.length > 0;

  const summaryText = totalFailure
    ? `保存失败：${failed.length} / ${accepts.length}。剧本草稿保留在 Redis，可重试。`
    : outcome === "committed"
      ? `已保存 ${committed.length} 集剧本，进入下一阶段。`
      : `部分成功：${committed.length} / ${accepts.length} 已保存，${failed.length} 失败。剧本草稿保留在 Redis。`;

  if (totalFailure) {
    const firstReason = failed[0]?.reason ?? "Java 批量写入全部失败";
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "script_phase",
      terminalStatus: "failed",
      error: `${summaryText}（首条失败原因：${firstReason}）`,
      retryable: true,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "script_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome,
      committedCount: 0,
      failedCount: failed.length,
      message: summaryText,
      completion: null,
      failure: failurePayload,
    };
  }

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "script_phase",
    committed: committed.map((c) => ({ serverId: c.episodeId, title: c.title })),
    failed: failed.map((f) => ({ clientRefId: f.episodeId, reason: f.reason })),
    summary: summaryText,
    nextSteps: [
      {
        workflowName: "storyboard_phase",
        labelKey: "workflowNextContinueToStoryboard",
        variant: "primary",
        // Scope storyboard generation to the episodes we just wrote scripts
        // for. Without this, storyboard_phase walks every episode with a
        // committed script in Java — including historical ones from earlier
        // runs the user isn't asking to redo.
        inputData: { onlyEpisodeIds: committed.map((c) => c.episodeId) },
      },
    ],
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "script_phase", {
      committed: completionPayload.committed,
      failed: completionPayload.failed,
      summary: completionPayload.summary,
      nextSteps: completionPayload.nextSteps,
    });
  }

  return {
    outcome,
    committedCount: committed.length,
    failedCount: failed.length,
    message: summaryText,
    completion: completionPayload,
    failure: null,
  };
}
