/**
 * scene_design — cold-start scene batch design.
 *
 * Twin of role_design but for scenes. Used when the user asks for N scenes
 * **without** having run story_outline first (e.g. freshly opened project,
 * user says "帮我想 5 个场景"). If story_outline has already run, prefer
 * scene_phase — it reads the settings roster and aligns with the story's
 * established framework.
 *
 * Flow mirrors role_design:
 *   plan_scenes (sceneDesigner generates N scenes from a short outline)
 *     → collect_drafts (write each as a Redis draft)
 *     → wait_confirmation (HITL)
 *     → apply_decision (batchUpsertScenes + commit)
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertScenes, type SceneCreateData } from "../lib/batch-writers/world-assets";
import {
  deleteAllDrafts,
  listDrafts,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  putDraft,
} from "../lib/drafts";
import { reportProgress, throwIfCancelled } from "./engine";
import { getContext } from "../lib/workspace-client";
import { summarizeBatch } from "../lib/batch-writer";
import { stylePaintingHint } from "../lib/style-painting";
import { robustStructuredGenerate } from "../lib/robust-generate";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../lib/workflow-messages";

// ─── Schemas ───────────────────────────────────────────────────────────

const PlannedScene = z.object({
  name: z.string().min(1).max(30),
  category: z.enum(["interior", "exterior", "mixed"]).default("interior"),
  timeOfDay: z.enum(["dawn", "day", "dusk", "night", "flexible"]).default("flexible"),
  setting: z.string().min(1),
  keyElements: z.array(z.string()).default([]),
  lighting: z.string().min(1),
  atmosphere: z.string().min(1),
  prompt: z.string().default(""),
});
type PlannedScene = z.infer<typeof PlannedScene>;

const InputSchema = z.object({
  outline: z.string().min(1, "Story outline is required"),
  worldId: z.string().min(1, "worldId is required"),
  sceneCount: z.number().int().min(1).max(20).default(5),
  feedback: z.string().optional(),
});

const OutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  plannedScenes: z.array(PlannedScene).default([]),
  draftClientRefIds: z.array(z.string()).default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  draftCount: z.number(),
  runId: z.string(),
});

// ─── Step 1: plan_scenes ──────────────────────────────────────────────

function buildPlanPrompt(input: z.infer<typeof InputSchema>, stylePainting?: string): string {
  const feedbackBlock = input.feedback
    ? `\n\n上一轮用户给的修改意见（必须采纳）：\n${input.feedback}\n`
    : "";
  return [
    `请基于以下故事梗概设计 ${input.sceneCount} 个有代表性的场景：`,
    "",
    input.outline,
    feedbackBlock,
    "",
    "要求：",
    `- 严格 ${input.sceneCount} 个，不多不少`,
    "- 场景之间差异明显，覆盖故事可能的空间（室内/室外、不同时间/天气）",
    "- 每个场景的 keyElements 要具体（3-7 条视觉锚点），后续可直接出参考图",
    "- prompt 是图像生成提示词，按场景设计师 persona 规定的格式写，60-120 字，顿号分隔；只写画面元素，不加画风/品质 token",
    "- 返回 JSON 对象，字段 scenes 是场景数组",
    stylePaintingHint(stylePainting),
  ]
    .filter(Boolean)
    .join("\n");
}

const planScenesStep = createStep({
  id: "plan_scenes",
  inputSchema: InputSchema,
  outputSchema: z.object({ done: z.literal(true) }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, state, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    const stylePainting = requestContext?.get("stylePainting") as string | undefined;
    const ctx = getContext(requestContext);
    if (runId) {
      await throwIfCancelled(runId);
      await reportProgress(runId, {
        stepId: "plan_scenes",
        current: 0,
        total: inputData.sceneCount,
        label: "场景设计师正在构思场景…",
      });
      await publishWorkflowProgress(ctx.projectId, runId, "scene_design", "planning", {
        current: 0,
        total: inputData.sceneCount,
        label: "场景设计师正在构思场景…",
      });
    }

    const designer = mastra?.getAgent("sceneDesigner");
    if (!designer) throw new Error("sceneDesigner agent not registered");

    const designerSchema = z.object({ scenes: z.array(PlannedScene) });
    const { object: designed } = await robustStructuredGenerate({
      agent: designer,
      prompt: buildPlanPrompt(inputData, stylePainting),
      schema: designerSchema,
      tag: `scene-designer-${runId ?? "nr"}`,
      isEmpty: (obj) => !obj?.scenes || obj.scenes.length === 0,
    });
    const plannedScenes = designed.scenes
      .slice(0, inputData.sceneCount)
      .filter((s) => s.name && s.setting);

    if (plannedScenes.length === 0) {
      throw new Error("sceneDesigner failed to produce any valid scenes");
    }

    setState({
      plannedScenes,
      draftClientRefIds: state.draftClientRefIds ?? [],
    });
    if (runId) {
      const doneLabel = `已设计 ${plannedScenes.length} 个场景`;
      await reportProgress(runId, {
        stepId: "plan_scenes",
        current: plannedScenes.length,
        total: inputData.sceneCount,
        label: doneLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "scene_design", "planning", {
        current: plannedScenes.length,
        total: inputData.sceneCount,
        label: doneLabel,
      });
    }
    return { done: true as const };
  },
});

// ─── Step 2: collect_drafts ───────────────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: z.object({ done: z.literal(true) }),
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ state, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    const worldId = requestContext?.get("worldId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    if (!worldId) throw new Error("worldId missing from requestContext");
    await throwIfCancelled(runId);

    const plannedScenes = state.plannedScenes ?? [];
    const draftClientRefIds: string[] = [];
    let i = 0;
    for (const scene of plannedScenes) {
      const clientRefId = randomUUID();
      const description = [
        `类型：${scene.category} · ${scene.timeOfDay}`,
        `环境：${scene.setting}`,
        scene.keyElements && scene.keyElements.length > 0
          ? `视觉锚点：${scene.keyElements.join("、")}`
          : "",
        `光线：${scene.lighting}`,
        `氛围：${scene.atmosphere}`,
      ]
        .filter(Boolean)
        .join("\n");
      const imagePrompt =
        scene.prompt && scene.prompt.trim().length > 0
          ? scene.prompt.trim()
          : [scene.setting, scene.lighting, scene.atmosphere].filter(Boolean).join("，");
      const data: SceneCreateData = {
        worldId,
        name: scene.name,
        description,
        prompt: imagePrompt,
      };
      await putDraft(runId, "scene", clientRefId, data);
      draftClientRefIds.push(clientRefId);
      i += 1;
      await reportProgress(runId, {
        stepId: "collect_drafts",
        current: i,
        total: plannedScenes.length,
        label: `已收集 ${i}/${plannedScenes.length} 个场景草稿`,
      });
    }

    setState({ plannedScenes, draftClientRefIds });
    return { draftCount: draftClientRefIds.length };
  },
});

// ─── Step 3: wait_confirmation ───────────────────────────────────────

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
        stepId: "wait_confirmation",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} 个场景草稿已生成，等待确认`,
      });
      const drafts = await listDrafts<SceneCreateData>(runId, {
        entityType: "scene",
        statuses: ["pending"],
      });
      await publishWorkflowSuspended(ctx.projectId, runId, "scene_design", {
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
      return await suspend({ runId, draftCount: inputData.draftCount });
    }
    return {
      approved: resumeData.approved,
      feedback: resumeData.feedback,
      acceptedClientRefIds: resumeData.acceptedClientRefIds,
    };
  },
});

// ─── Step 4: apply_decision ─────────────────────────────────────────

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const draftClientRefIds = state.draftClientRefIds ?? [];

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      await publishWorkflowFailed(ctx.projectId, runId, "scene_design", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback ? `用户未通过。反馈：${inputData.feedback}` : "用户未通过。",
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

    for (const item of items) await markDraftCommitting(runId, item.clientRefId);

    const startLabel = `入库 ${items.length} 个场景到项目…`;
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 0,
      total: items.length,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "scene_design", "committing", {
      current: 0,
      total: items.length,
      label: startLabel,
    });

    const results = await batchUpsertScenes(ctx, items, { concurrency: 1 });

    const committed: { clientRefId: string; serverId: string }[] = [];
    const failed: { clientRefId: string; reason: string }[] = [];
    for (const r of results) {
      if (r.status === "created" || r.status === "unchanged") {
        await markDraftCommitted(runId, r.clientRefId, r.serverId!);
        committed.push({ clientRefId: r.clientRefId, serverId: r.serverId! });
      } else {
        await markDraftFailed(runId, r.clientRefId, r.error ?? "unknown");
        failed.push({ clientRefId: r.clientRefId, reason: r.error ?? "unknown" });
      }
    }

    const summary = summarizeBatch(results);
    const outcome: z.infer<typeof OutputSchema>["outcome"] =
      summary.failed === 0 ? "committed" : "partial_failure";

    if (outcome === "committed") await deleteAllDrafts(runId);

    const endLabel = `入库完成 — 成功 ${committed.length}，失败 ${failed.length}`;
    await publishWorkflowProgress(ctx.projectId, runId, "scene_design", "committing", {
      current: committed.length,
      total: items.length,
      label: endLabel,
    });

    const summaryText =
      outcome === "committed"
        ? `已成功入库 ${committed.length} 个场景。`
        : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`;

    await publishWorkflowCompleted(ctx.projectId, runId, "scene_design", {
      committed: committed.map((c) => ({ serverId: c.serverId })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summary: summaryText,
      nextSteps: [
        {
          workflowName: "scene_image_phase",
          labelKey: "workflowNextContinueToSceneImages",
          variant: "primary",
          inputData: { onlyAssetIds: committed.map((c) => c.serverId) },
        },
      ],
    });

    return {
      outcome,
      committed,
      failed,
      message: summaryText,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const sceneDesignWorkflow = createWorkflow({
  id: "scene_design",
  description:
    "冷启动批量设计场景：根据一句话梗概凭空设计 N 个场景 → 人工确认 → 入库。没有 outline / 名册时用这个；有 outline 时优先 scene_phase。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
})
  .then(planScenesStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();
