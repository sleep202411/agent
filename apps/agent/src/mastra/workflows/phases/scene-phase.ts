/**
 * scene_phase — produce a committed scene list from the project skeleton.
 *
 * Mirror of role_phase. Loads the story outline, walks each entry in the
 * `settings` roster, asks sceneDesigner to elaborate into a shoot-ready
 * scene spec (setting / lighting / atmosphere / keyElements / props), then
 * drafts → HITL → batch commits to Java's worldscene.
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
import { reportProgress, startWorkflow, throwIfCancelled } from "../engine";
import { getContext } from "../../lib/workspace-client";
import { summarizeBatch } from "../../lib/batch-writer";
import { getOutline, type StoryOutline } from "../../lib/outline";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";

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
  outcome: z.enum(["committed", "rejected", "partial_failure", "no_settings"]),
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string(), name: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), name: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  draftClientRefIds: z.array(z.string()).default([]),
  nameByRef: z.record(z.string(), z.string()).default({}),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  sceneCount: z.number(),
  phase: z.literal("scene"),
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

// ─── Step 1: collect drafts ───────────────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: ResolvedInputSchema,
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const draftClientRefIds: string[] = [];
    const nameByRef: Record<string, string> = {};
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
      draftClientRefIds.push(clientRefId);
      nameByRef[clientRefId] = s.name;
      i += 1;
      await reportProgress(runId, {
        stepId: "scene_phase.collect",
        current: i,
        total: inputData.scenes.length,
        label: `已收集 ${i}/${inputData.scenes.length} 个场景草稿`,
      });
    }
    setState({ draftClientRefIds, nameByRef });
    return { draftCount: draftClientRefIds.length };
  },
});

// ─── Step 2: HITL gate ────────────────────────────────────────────────

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
    const ctx = getContext(requestContext);

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "scene_phase.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `已生成 ${inputData.draftCount} 个场景，等待确认后进入下一阶段`,
      });
      const drafts = await listDrafts<SceneCreateData>(runId, {
        entityType: "scene",
        statuses: ["pending"],
      });
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
      });
      return await suspend({
        runId,
        sceneCount: inputData.draftCount,
        phase: "scene" as const,
      });
    }
    return {
      approved: resumeData.approved,
      feedback: resumeData.feedback,
      acceptedClientRefIds: resumeData.acceptedClientRefIds,
    };
  },
});

// ─── Step 3: commit or reject ─────────────────────────────────────────

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: ScenePhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const draftClientRefIds = state.draftClientRefIds ?? [];
    const nameByRef = state.nameByRef ?? {};

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      await publishWorkflowFailed(ctx.projectId, runId, "scene_phase", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `场景阶段未通过。反馈：${inputData.feedback}`
          : "场景阶段未通过。",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<SceneCreateData>(runId, {
      entityType: "scene",
      statuses: ["pending"],
    });
    const items = drafts
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

    const committed: ScenePhaseOutput["committed"] = [];
    const failed: ScenePhaseOutput["failed"] = [];
    for (const r of results) {
      const name = nameByRef[r.clientRefId] ?? "(unknown)";
      if (r.status === "created" || r.status === "unchanged") {
        await markDraftCommitted(runId, r.clientRefId, r.serverId!);
        committed.push({ clientRefId: r.clientRefId, serverId: r.serverId!, name });
      } else {
        await markDraftFailed(runId, r.clientRefId, r.error ?? "unknown");
        failed.push({ clientRefId: r.clientRefId, name, reason: r.error ?? "unknown" });
      }
    }

    const summary = summarizeBatch(results);
    const outcome = summary.failed === 0 ? ("committed" as const) : ("partial_failure" as const);

    if (outcome === "committed") await deleteAllDrafts(runId);

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

    await publishWorkflowCompleted(ctx.projectId, runId, "scene_phase", {
      committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summary: summaryText,
      // Compact chip — image phase's progress card takes the "big" slot.
      compact: true,
      // No nextStep — image gen auto-chains below (see role-phase comment).
    });

    // Auto-chain regardless of partial_failure — image phase works off
    // whatever's in Java, hard failures throw before here and surface on
    // the workflow_failed card with a retry button.
    try {
      await startWorkflow({
        workflowName: "scene_image_phase",
        inputData: {},
        ctx,
      });
    } catch (err) {
      console.warn(
        `[scene_phase] auto-chain scene_image_phase failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已入库 ${committed.length} 个场景，进入下一阶段。`
          : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scenePhaseWorkflow = createWorkflow({
  id: "scene_phase",
  description: "场景阶段：从故事骨架 settings 名册扩展出完整场景设计，草稿 → HITL → 入库。",
  inputSchema: ScenePhaseInputSchema,
  outputSchema: ScenePhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type ScenePhaseOutput = z.infer<typeof ScenePhaseOutputSchema>;
