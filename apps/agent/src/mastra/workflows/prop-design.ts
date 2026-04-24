/**
 * prop_design — cold-start prop batch design.
 *
 * Twin of role_design / scene_design but for props. Used when the user asks
 * for N story-relevant props without having run story_outline first. If
 * outline exists, prefer prop_phase — it reads the props roster and aligns
 * with the story.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertProps, type PropCreateData } from "../lib/batch-writers/world-assets";
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

const PlannedProp = z.object({
  name: z.string().min(1).max(30),
  category: z
    .enum(["object", "document", "apparel", "vehicle", "weapon", "food", "art", "other"])
    .default("object"),
  era: z.string().default("当代"),
  material: z.string().min(1),
  appearance: z.string().min(1),
  significance: z.string().min(1),
  prompt: z.string().default(""),
});
type PlannedProp = z.infer<typeof PlannedProp>;

const InputSchema = z.object({
  outline: z.string().min(1, "Story outline is required"),
  worldId: z.string().min(1, "worldId is required"),
  propCount: z.number().int().min(1).max(15).default(5),
  feedback: z.string().optional(),
});

const OutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  plannedProps: z.array(PlannedProp).default([]),
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

// ─── Step 1: plan_props ──────────────────────────────────────────────

function buildPlanPrompt(input: z.infer<typeof InputSchema>, stylePainting?: string): string {
  const feedbackBlock = input.feedback
    ? `\n\n上一轮用户给的修改意见（必须采纳）：\n${input.feedback}\n`
    : "";
  return [
    `请基于以下故事梗概设计 ${input.propCount} 个剧情相关的关键道具：`,
    "",
    input.outline,
    feedbackBlock,
    "",
    "要求：",
    `- 严格 ${input.propCount} 个，不多不少`,
    "- 只设计**剧情上有意义的**道具（推动情节/承载情感/象征意义）",
    "- 不要列泛用日常物（桌椅杯盘）",
    "- appearance 40-80 字，强调可识别细节（划痕、铭文、颜色、尺寸）",
    "- significance 说清楚这个道具为什么重要",
    "- prompt 是图像生成提示词，按道具设计师 persona 规定的格式写，60-120 字，顿号分隔；只写画面元素，不加画风/品质 token",
    "- 返回 JSON 对象，字段 props 是道具数组",
    stylePaintingHint(stylePainting),
  ]
    .filter(Boolean)
    .join("\n");
}

const planPropsStep = createStep({
  id: "plan_props",
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
        stepId: "plan_props",
        current: 0,
        total: inputData.propCount,
        label: "道具设计师正在构思道具…",
      });
      await publishWorkflowProgress(ctx.projectId, runId, "prop_design", "planning", {
        current: 0,
        total: inputData.propCount,
        label: "道具设计师正在构思道具…",
      });
    }

    const designer = mastra?.getAgent("propDesigner");
    if (!designer) throw new Error("propDesigner agent not registered");

    const designerSchema = z.object({ props: z.array(PlannedProp) });
    const { object: designed } = await robustStructuredGenerate({
      agent: designer,
      prompt: buildPlanPrompt(inputData, stylePainting),
      schema: designerSchema,
      tag: `prop-designer-${runId ?? "nr"}`,
      isEmpty: (obj) => !obj?.props || obj.props.length === 0,
    });
    const plannedProps = designed.props
      .slice(0, inputData.propCount)
      .filter((p) => p.name && p.material);

    if (plannedProps.length === 0) {
      throw new Error("propDesigner failed to produce any valid props");
    }

    setState({
      plannedProps,
      draftClientRefIds: state.draftClientRefIds ?? [],
    });
    if (runId) {
      const doneLabel = `已设计 ${plannedProps.length} 个道具`;
      await reportProgress(runId, {
        stepId: "plan_props",
        current: plannedProps.length,
        total: inputData.propCount,
        label: doneLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "prop_design", "planning", {
        current: plannedProps.length,
        total: inputData.propCount,
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

    const plannedProps = state.plannedProps ?? [];
    const draftClientRefIds: string[] = [];
    let i = 0;
    for (const prop of plannedProps) {
      const clientRefId = randomUUID();
      const description = [
        `类型：${prop.category} · ${prop.era}`,
        `材质：${prop.material}`,
        `外观：${prop.appearance}`,
        `剧情功能：${prop.significance}`,
      ].join("\n");
      const imagePrompt =
        prop.prompt && prop.prompt.trim().length > 0 ? prop.prompt.trim() : prop.appearance;
      const data: PropCreateData = {
        worldId,
        name: prop.name,
        description,
        prompt: imagePrompt,
      };
      await putDraft(runId, "prop", clientRefId, data);
      draftClientRefIds.push(clientRefId);
      i += 1;
      await reportProgress(runId, {
        stepId: "collect_drafts",
        current: i,
        total: plannedProps.length,
        label: `已收集 ${i}/${plannedProps.length} 个道具草稿`,
      });
    }

    setState({ plannedProps, draftClientRefIds });
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
        label: `${inputData.draftCount} 个道具草稿已生成，等待确认`,
      });
      const drafts = await listDrafts<PropCreateData>(runId, {
        entityType: "prop",
        statuses: ["pending"],
      });
      await publishWorkflowSuspended(ctx.projectId, runId, "prop_design", {
        draftGroups: [
          {
            entityType: "prop",
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
      await publishWorkflowFailed(ctx.projectId, runId, "prop_design", {
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
    const drafts = await listDrafts<PropCreateData>(runId, {
      entityType: "prop",
      statuses: ["pending"],
    });
    const items = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

    for (const item of items) await markDraftCommitting(runId, item.clientRefId);

    const startLabel = `入库 ${items.length} 个道具到项目…`;
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 0,
      total: items.length,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "prop_design", "committing", {
      current: 0,
      total: items.length,
      label: startLabel,
    });

    const results = await batchUpsertProps(ctx, items, { concurrency: 1 });

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
    await publishWorkflowProgress(ctx.projectId, runId, "prop_design", "committing", {
      current: committed.length,
      total: items.length,
      label: endLabel,
    });

    const summaryKey =
      outcome === "committed" ? "propDesignSummaryCommitted" : "propDesignSummaryPartial";
    const summaryParams = {
      count: committed.length,
      failed: failed.length,
      total: items.length,
    };
    const logMessage =
      outcome === "committed"
        ? `committed ${committed.length} props`
        : `partial failure: ${committed.length} ok, ${failed.length} failed`;

    await publishWorkflowCompleted(ctx.projectId, runId, "prop_design", {
      committed: committed.map((c) => ({ serverId: c.serverId })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summaryKey,
      summaryParams,
      nextSteps: [
        {
          workflowName: "prop_image_phase",
          labelKey: "workflowNextContinueToPropImages",
          variant: "primary",
          inputData: { onlyAssetIds: committed.map((c) => c.serverId) },
        },
      ],
    });

    return {
      outcome,
      committed,
      failed,
      message: logMessage,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const propDesignWorkflow = createWorkflow({
  id: "prop_design",
  description:
    "冷启动批量设计道具：根据一句话梗概凭空设计 N 个剧情相关的关键道具 → 人工确认 → 入库。没有 outline / 名册时用这个；有 outline 时优先 prop_phase。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
})
  .then(planPropsStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();
