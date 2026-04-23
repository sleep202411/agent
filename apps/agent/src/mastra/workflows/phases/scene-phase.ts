/**
 * scene_phase — produce scene drafts and end.
 *
 * Post-Stage-C model: each HITL phase is a short-lived workflow that
 * generates drafts → publishes `workflow_suspended` event (naming kept
 * for frontend compat) → ends. No Mastra suspend/resume. Commit (or
 * discard) happens out-of-band via `applySceneDrafts()` called from the
 * `apply_phase_drafts` tool OR the Nest `/workflow/:runId/confirm`
 * short-circuit.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertScenes, type SceneCreateData } from "../../lib/batch-writers/world-assets";
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
import { getContext, type StoryosContext } from "../../lib/workspace-client";
import { summarizeBatch } from "../../lib/batch-writer";
import { getOutline, type StoryOutline } from "../../lib/outline";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";
import { publishEntityEvent } from "../../lib/entity-events";
import type { WorkflowCompletedOutput, WorkflowFailedOutput } from "@repo/shared";

// ─── Schemas ───────────────────────────────────────────────────────────

const SceneDesignSchema = z.object({
  name: z.string().min(1).max(30),
  category: z.enum(["interior", "exterior", "mixed"]).default("interior"),
  timeOfDay: z.enum(["dawn", "day", "dusk", "night", "flexible"]).default("flexible"),
  weather: z.string().nullable().optional(),
  setting: z.string().min(1),
  keyElements: z.array(z.string()).default([]),
  props: z.array(z.string()).default([]),
  lighting: z.string().min(1),
  atmosphere: z.string().min(1),
  cameraHints: z.array(z.string()).default([]),
  continuityNotes: z.string().nullable().optional(),
  alignsWithStyle: z.string().default(""),
  /**
   * Image-generation prompt — visual-token optimized string fed to the image
   * model. Optional at the LLM layer so a miss doesn't invalidate the whole
   * design; we synthesize from setting+lighting+atmosphere as fallback at
   * `collect_drafts`.
   */
  prompt: z.string().default(""),
});

export const ScenePhaseInputSchema = z.object({
  worldId: z.string().min(1),
  feedback: z.string().optional(),
});

export const ScenePhaseOutputSchema = z.object({
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
});

const ResolvedInputSchema = z.object({
  worldId: z.string().min(1),
  scenes: z.array(SceneDesignSchema).min(1),
});

// ─── Step 0: resolve scenes from skeleton settings roster ─────────────

function buildElaboratePrompt(
  skeleton: StoryOutline,
  entry: StoryOutline["settings"][number],
  feedback?: string
): string {
  const chapterRefs = entry.firstAppearance
    ? skeleton.structure
        .filter((ch) => ch.chapterId === entry.firstAppearance)
        .map((ch) => `- ${ch.chapterId} 《${ch.title}》：${ch.summary}`)
        .join("\n")
    : "";
  const feedbackBlock = feedback ? `\n\n【用户补充意见（优先遵循）】\n${feedback}\n` : "";
  return [
    "请基于下面的故事骨架与场景名册条目，产出**一个完整场景设计**（JSON）。",
    "",
    "## 故事概况",
    `类型：${skeleton.genre} / 基调：${skeleton.tone}`,
    `主线：${skeleton.threads.main}`,
    `摘要：${skeleton.storySummary}`,
    "",
    "## 这个场景在骨架里的信息",
    `- 名称：${entry.name}`,
    `- 空间类型提示：${entry.typeHint}`,
    entry.firstAppearance ? `- 首次出现：${entry.firstAppearance}` : "",
    chapterRefs ? `\n相关章节：\n${chapterRefs}` : "",
    feedbackBlock,
    "",
    "## 必须遵守 Scene Designer 的 JSON schema，字段含义看你 system prompt。",
    "- name 沿用骨架里给的名称，不要改",
    "- keyElements 3-7 个具体视觉锚点",
    "- lighting / atmosphere 各 30-60 字",
    "- prompt 是**图像生成提示词** —— 40-80 字视觉 token 串，按「场景类型+时间光线+空间布局+关键视觉元素+氛围」顺序、顿号分隔。只写画面元素。**不要**加画风/品质 token（写实、电影感、4k 等）—— 下游会按项目 stylePainting 拼接。",
  ]
    .filter(Boolean)
    .join("\n");
}

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: ScenePhaseInputSchema,
  outputSchema: ResolvedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const ctx = getContext(requestContext);
    const record = await getOutline(ctx.projectId);
    if (!record) {
      throw new Error(
        `scene_phase: no story outline cached for project ${ctx.projectId}. Run story_outline first.`
      );
    }
    const sceneDesigner = mastra?.getAgent("sceneDesigner");
    if (!sceneDesigner) throw new Error("sceneDesigner agent not registered");

    const settings = record.outline.settings ?? [];
    if (settings.length === 0) {
      throw new Error("scene_phase: story outline has empty settings roster");
    }

    const scenes: z.infer<typeof SceneDesignSchema>[] = [];
    for (let i = 0; i < settings.length; i++) {
      const entry = settings[i];
      await throwIfCancelled(runId);
      const label = `场景设计师正在扩展「${entry.name}」…`;
      await reportProgress(runId, {
        stepId: "scene_phase.elaborate",
        current: i,
        total: settings.length,
        label,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "scene_phase", "planning", {
        current: i,
        total: settings.length,
        label,
      });
      const prompt = buildElaboratePrompt(record.outline, entry, inputData.feedback);
      const response = await sceneDesigner.generate(prompt, {
        structuredOutput: {
          schema: SceneDesignSchema,
          errorStrategy: "warn",
        },
      });
      const designed = response.object as z.infer<typeof SceneDesignSchema> | undefined;
      if (!designed) {
        // eslint-disable-next-line no-console
        console.warn(`[scene_phase] sceneDesigner returned no design for ${entry.name}, skipping`);
        continue;
      }
      scenes.push({ ...designed, name: entry.name }); // force roster name
    }
    if (scenes.length === 0) {
      throw new Error("scene_phase: sceneDesigner returned no designs for any setting");
    }
    const doneLabel = `场景设计完成：${scenes.length} 个`;
    await reportProgress(runId, {
      stepId: "scene_phase.elaborate",
      current: scenes.length,
      total: settings.length,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "scene_phase", "planning", {
      current: scenes.length,
      total: settings.length,
      label: doneLabel,
    });
    return { worldId: inputData.worldId, scenes };
  },
});

// ─── Step 1: collect drafts into Redis ────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: ResolvedInputSchema,
  outputSchema: z.object({ draftCount: z.number() }),
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    let i = 0;
    for (const s of inputData.scenes) {
      const clientRefId = randomUUID();
      const description = [
        `类型：${s.category} · ${s.timeOfDay}${s.weather ? ` · ${s.weather}` : ""}`,
        `环境：${s.setting}`,
        s.keyElements.length > 0 ? `视觉锚点：${s.keyElements.join("、")}` : "",
        s.props.length > 0 ? `关键道具：${s.props.join("、")}` : "",
        `光线：${s.lighting}`,
        `氛围：${s.atmosphere}`,
        s.cameraHints.length > 0 ? `镜头建议：${s.cameraHints.join("；")}` : "",
        s.continuityNotes ? `连贯性：${s.continuityNotes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      // Prefer the dedicated LLM-produced image prompt; fall back to
      // composing setting+lighting+atmosphere if the model skipped it
      // (older-ai-version compat — normally errorStrategy: warn bumps it up).
      const imagePrompt =
        s.prompt && s.prompt.trim().length > 0
          ? s.prompt.trim()
          : [s.setting, s.lighting, s.atmosphere].filter(Boolean).join("，");
      const data: SceneCreateData = {
        worldId: inputData.worldId,
        name: s.name,
        description,
        prompt: imagePrompt,
      };
      await putDraft(runId, "scene", clientRefId, data);
      i += 1;
      await reportProgress(runId, {
        stepId: "scene_phase.collect",
        current: i,
        total: inputData.scenes.length,
        label: `已收集 ${i}/${inputData.scenes.length} 个场景草稿`,
      });
    }
    return { draftCount: i };
  },
});

// ─── Step 2: emit awaiting-review event + end ─────────────────────────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ draftCount: z.number() }),
  outputSchema: ScenePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    await reportProgress(runId, {
      stepId: "scene_phase.review",
      current: inputData.draftCount,
      total: inputData.draftCount,
      label: `已生成 ${inputData.draftCount} 个场景，等待确认后进入下一阶段`,
    });

    const drafts = await listDrafts<SceneCreateData>(runId, {
      entityType: "scene",
      statuses: ["pending"],
    });
    // Keep event name `workflow_suspended` so the existing frontend card
    // renders without changes. Semantically this is "awaiting review" now —
    // the Mastra run has terminated successfully.
    await publishWorkflowSuspended(ctx.projectId, runId, "scene_phase", {
      draftGroups: [
        {
          entityType: "scene",
          count: drafts.length,
          items: drafts.map((d) => ({
            clientRefId: d.clientRefId,
            data: d.data as unknown as Record<string, unknown>,
          })),
        },
      ],
      totalDraftCount: drafts.length,
      estimatedCost: drafts.length * PRICES.scenePerUnit,
    });

    return {
      runId,
      draftCount: inputData.draftCount,
      message: `已生成 ${inputData.draftCount} 个场景草稿，等待确认。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scenePhaseWorkflow = createWorkflow({
  id: "scene_phase",
  description:
    "场景阶段：从故事骨架 settings 扩展 → 场景草稿入 Redis → 等用户确认。确认后走 apply_phase_drafts 入库，不再走 Mastra resume。",
  inputSchema: ScenePhaseInputSchema,
  outputSchema: ScenePhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(emitReviewStep)
  .commit();

// ─── Apply helper (called from apply_phase_drafts tool + Nest /confirm) ─

export interface ApplySceneDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
  /** See role-phase.applyRoleDrafts for rationale. */
  emitLifecycleMessage?: boolean;
}

export interface ApplySceneDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

/**
 * Commit / discard scene drafts. Invoked after user decides (either via
 * `apply_phase_drafts` tool from LLM, or Nest's `/workflow/:runId/confirm`
 * short-circuit when the frontend button fires). Same logic the old
 * `applyDecisionStep` did inside the suspended workflow.
 */
export async function applySceneDrafts(
  opts: ApplySceneDraftsOptions
): Promise<ApplySceneDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
  await throwIfCancelled(runId);

  const pending = await listDrafts<SceneCreateData>(runId, {
    entityType: "scene",
    statuses: ["pending"],
  });
  const nameByRef: Record<string, string> = {};
  for (const d of pending) nameByRef[d.clientRefId] = d.data.name;
  const pendingRefIds = pending.map((d) => d.clientRefId);

  // Charge regardless of approved/rejected — LLM generation cost was
  // already incurred when drafts were produced. Idempotent on repeat calls.
  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.scenePerUnit,
      reason: `scene_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "scene_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "scene_phase",
      terminalStatus: "cancelled",
      error: feedback ? `用户要求修改：${feedback}` : "用户未通过。",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "scene_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `场景阶段未通过。反馈：${feedback}` : "场景阶段未通过。",
      completion: null,
      failure: failurePayload,
    };
  }

  const accepted = new Set(acceptedClientRefIds ?? pendingRefIds);
  const items = pending
    .filter((d) => accepted.has(d.clientRefId))
    .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

  for (const it of items) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `入库 ${items.length} 个场景…`;
  await reportProgress(runId, {
    stepId: "scene_phase.commit",
    current: 0,
    total: items.length,
    label: startLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "scene_phase", "committing", {
    current: 0,
    total: items.length,
    label: startLabel,
  });

  const results = await batchUpsertScenes(ctx, items, { concurrency: 1 });

  const committed: Array<{ serverId: string; name: string }> = [];
  const failed: Array<{ clientRefId: string; name: string; reason: string }> = [];
  for (const r of results) {
    const name = nameByRef[r.clientRefId] ?? "(unknown)";
    if (r.status === "created" || r.status === "unchanged") {
      await markDraftCommitted(runId, r.clientRefId, r.serverId!);
      committed.push({ serverId: r.serverId!, name });
    } else {
      await markDraftFailed(runId, r.clientRefId, r.error ?? "unknown");
      failed.push({ clientRefId: r.clientRefId, name, reason: r.error ?? "unknown" });
    }
  }

  const summary = summarizeBatch(results);
  const outcome = summary.failed === 0 ? ("committed" as const) : ("partial_failure" as const);
  if (outcome === "committed") await deleteAllDrafts(runId);

  if (committed.length > 0) {
    await publishEntityEvent(ctx, {
      entity: "scene",
      action: "batch_created",
      source: "scene_phase",
    });
  }

  const endLabel = `场景入库完成：成功 ${committed.length} / 失败 ${failed.length}`;
  await reportProgress(runId, {
    stepId: "scene_phase.commit",
    current: committed.length,
    total: items.length,
    label: endLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "scene_phase", "committing", {
    current: committed.length,
    total: items.length,
    label: endLabel,
  });

  const summaryText =
    outcome === "committed"
      ? `已入库 ${committed.length} 个场景，进入下一阶段。`
      : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`;

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "scene_phase",
    committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
    failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
    summary: summaryText,
    nextSteps: [
      {
        workflowName: "scene_image_phase",
        labelKey: "workflowNextContinueToSceneImages",
        variant: "primary",
        inputData: { onlyAssetIds: committed.map((c) => c.serverId) },
      },
      {
        workflowName: "prop_phase",
        labelKey: "workflowNextSkipToProps",
        variant: "secondary",
      },
    ],
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "scene_phase", {
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
