/**
 * prop_phase — produce a committed prop list from the project skeleton.
 *
 * Mirror of role_phase / scene_phase. Uses the `props` roster from the story
 * outline (added in script-breakdown BreakdownShape). Each entry gets
 * elaborated by propDesigner into a full prop spec → draft → HITL → commit
 * to Java's worldprop table.
 *
 * If the outline has no props roster (older outlines may not, schema is
 * optional), this workflow exits cleanly with `no_props`.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertProps, type PropCreateData } from "../../lib/batch-writers/world-assets";
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
  publishWorkflowStarted,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";

// ─── Schemas ───────────────────────────────────────────────────────────

const PropDesignSchema = z.object({
  name: z.string().min(1).max(30),
  category: z
    .enum(["object", "document", "apparel", "vehicle", "weapon", "food", "art", "other"])
    .default("object"),
  era: z.string().default("当代"),
  material: z.string().min(1),
  appearance: z.string().min(1),
  significance: z.string().min(1),
  keyScenes: z.array(z.string()).default([]),
  alignsWithStyle: z.string().default(""),
  /**
   * Image-generation prompt — visual-token optimized string fed to the image
   * model. Optional at the LLM layer so a miss doesn't invalidate the whole
   * design; we fall back to `appearance` at collect_drafts.
   */
  prompt: z.string().default(""),
});

export const PropPhaseInputSchema = z.object({
  worldId: z.string().min(1),
  feedback: z.string().optional(),
});

export const PropPhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure", "no_props"]),
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
  propCount: z.number(),
  phase: z.literal("prop"),
});

const ResolvedInputSchema = z.object({
  worldId: z.string().min(1),
  props: z.array(PropDesignSchema),
});

// ─── Step 0: resolve props from skeleton props roster ─────────────────

type PropRosterEntry = NonNullable<StoryOutline["props"]>[number];

function buildElaboratePrompt(
  skeleton: StoryOutline,
  entry: PropRosterEntry,
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
    "请基于下面的故事骨架与道具名册条目，产出**一个完整道具设计**（JSON）。",
    "",
    "## 故事概况",
    `类型：${skeleton.genre} / 基调：${skeleton.tone}`,
    `主线：${skeleton.threads.main}`,
    `摘要：${skeleton.storySummary}`,
    "",
    "## 这个道具在骨架里的信息",
    `- 名称：${entry.name}`,
    `- 类型提示：${entry.typeHint}`,
    entry.firstAppearance ? `- 首次出现：${entry.firstAppearance}` : "",
    chapterRefs ? `\n相关章节：\n${chapterRefs}` : "",
    feedbackBlock,
    "",
    "## 必须遵守 Prop Designer 的 JSON schema，字段含义看你 system prompt。",
    "- name 沿用骨架里给的名称，不要改",
    "- appearance 40-80 字、强调可识别细节（给人看）",
    "- significance 紧扣道具在故事中的剧情功能",
    "- prompt 是**图像生成提示词** —— 40-80 字视觉 token 串，按「道具主体+材质+年代感+使用痕迹+特写/静物视角」顺序、顿号分隔。只写画面能看见的细节。**不要**加画风/品质 token（写实、微距、电影感 等）—— 下游按项目 stylePainting 自动拼接。不要写剧情/情感用途。",
  ]
    .filter(Boolean)
    .join("\n");
}

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: PropPhaseInputSchema,
  outputSchema: ResolvedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const ctx = getContext(requestContext);
    const record = await getOutline(ctx.projectId);
    if (!record) {
      throw new Error(
        `prop_phase: no story outline cached for project ${ctx.projectId}. Run story_outline first.`
      );
    }
    const propDesigner = mastra?.getAgent("propDesigner");
    if (!propDesigner) throw new Error("propDesigner agent not registered");

    const propsRoster = record.outline.props ?? [];
    if (propsRoster.length === 0) {
      // Not an error — story may not warrant any story-relevant props.
      await publishWorkflowStarted(ctx.projectId, runId, "prop_phase", {
        plannedCount: 0,
        summary: "故事里没有剧情级道具，将跳过本阶段。",
      });
      return { worldId: inputData.worldId, props: [] };
    }

    await publishWorkflowStarted(ctx.projectId, runId, "prop_phase", {
      plannedCount: propsRoster.length,
      summary: `道具设计师将扩展 ${propsRoster.length} 个道具。`,
    });

    const props: z.infer<typeof PropDesignSchema>[] = [];
    for (let i = 0; i < propsRoster.length; i++) {
      const entry = propsRoster[i];
      await throwIfCancelled(runId);
      const label = `道具设计师正在扩展「${entry.name}」…`;
      await reportProgress(runId, {
        stepId: "prop_phase.elaborate",
        current: i,
        total: propsRoster.length,
        label,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "prop_phase", "planning", {
        current: i,
        total: propsRoster.length,
        label,
      });
      const prompt = buildElaboratePrompt(record.outline, entry, inputData.feedback);
      const response = await propDesigner.generate(prompt, {
        structuredOutput: {
          schema: PropDesignSchema,
          errorStrategy: "warn",
        },
      });
      const designed = response.object as z.infer<typeof PropDesignSchema> | undefined;
      if (!designed) {
        // eslint-disable-next-line no-console
        console.warn(`[prop_phase] propDesigner returned no design for ${entry.name}, skipping`);
        continue;
      }
      props.push({ ...designed, name: entry.name });
    }
    const doneLabel = `道具设计完成：${props.length} 个`;
    await reportProgress(runId, {
      stepId: "prop_phase.elaborate",
      current: props.length,
      total: propsRoster.length,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "prop_phase", "planning", {
      current: props.length,
      total: propsRoster.length,
      label: doneLabel,
    });
    return { worldId: inputData.worldId, props };
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
    for (const p of inputData.props) {
      const clientRefId = randomUUID();
      const description = [
        `类型：${p.category} · ${p.era}`,
        `材质：${p.material}`,
        `外观：${p.appearance}`,
        `剧情功能：${p.significance}`,
        p.keyScenes.length > 0 ? `关键出场：${p.keyScenes.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const imagePrompt = p.prompt && p.prompt.trim().length > 0 ? p.prompt.trim() : p.appearance;
      const data: PropCreateData = {
        worldId: inputData.worldId,
        name: p.name,
        description,
        prompt: imagePrompt,
      };
      await putDraft(runId, "prop", clientRefId, data);
      draftClientRefIds.push(clientRefId);
      nameByRef[clientRefId] = p.name;
      i += 1;
      await reportProgress(runId, {
        stepId: "prop_phase.collect",
        current: i,
        total: inputData.props.length,
        label: `已收集 ${i}/${inputData.props.length} 个道具草稿`,
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

    // Fast-path: zero props in the outline roster — don't bother suspending.
    if (inputData.draftCount === 0) {
      return { approved: true, feedback: undefined, acceptedClientRefIds: [] };
    }

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "prop_phase.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `已生成 ${inputData.draftCount} 个道具，等待确认后进入下一阶段`,
      });
      const drafts = await listDrafts<PropCreateData>(runId, {
        entityType: "prop",
        statuses: ["pending"],
      });
      await publishWorkflowSuspended(ctx.projectId, runId, "prop_phase", {
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
      return await suspend({
        runId,
        propCount: inputData.draftCount,
        phase: "prop" as const,
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
  outputSchema: PropPhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const draftClientRefIds = state.draftClientRefIds ?? [];
    const nameByRef = state.nameByRef ?? {};

    // Zero-props short-circuit from waitConfirmationStep. Even with no
    // props to commit, auto-chain to prop_image_phase so the user gets a
    // uniform flow (the image phase will itself emit "no_props" and move
    // on quickly).
    if (draftClientRefIds.length === 0) {
      await publishWorkflowCompleted(ctx.projectId, runId, "prop_phase", {
        committed: [],
        summary: "本故事骨架里没有需要单独设计的道具，已跳过。",
        compact: true,
      });
      try {
        await startWorkflow({
          workflowName: "prop_image_phase",
          inputData: {},
          ctx,
        });
      } catch (err) {
        console.warn(
          `[prop_phase] auto-chain prop_image_phase failed (no_props path):`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return {
        outcome: "no_props" as const,
        committed: [],
        failed: [],
        message: "本故事骨架里没有需要单独设计的道具，已跳过。",
      };
    }

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      await publishWorkflowFailed(ctx.projectId, runId, "prop_phase", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `道具阶段未通过。反馈：${inputData.feedback}`
          : "道具阶段未通过。",
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

    for (const it of items) await markDraftCommitting(runId, it.clientRefId);

    const startLabel = `入库 ${items.length} 个道具…`;
    await reportProgress(runId, {
      stepId: "prop_phase.commit",
      current: 0,
      total: items.length,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "prop_phase", "committing", {
      current: 0,
      total: items.length,
      label: startLabel,
    });

    const results = await batchUpsertProps(ctx, items, { concurrency: 1 });

    const committed: PropPhaseOutput["committed"] = [];
    const failed: PropPhaseOutput["failed"] = [];
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

    const endLabel = `道具入库完成：成功 ${committed.length} / 失败 ${failed.length}`;
    await reportProgress(runId, {
      stepId: "prop_phase.commit",
      current: committed.length,
      total: items.length,
      label: endLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "prop_phase", "committing", {
      current: committed.length,
      total: items.length,
      label: endLabel,
    });

    const summaryText =
      outcome === "committed"
        ? `已入库 ${committed.length} 个道具，进入下一阶段。`
        : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`;

    await publishWorkflowCompleted(ctx.projectId, runId, "prop_phase", {
      committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summary: summaryText,
      // Compact chip — image phase's progress card takes the "big" slot.
      compact: true,
      // No nextStep — image gen auto-chains below.
    });

    // Auto-chain regardless of partial_failure — see role-phase comment.
    try {
      await startWorkflow({
        workflowName: "prop_image_phase",
        inputData: {},
        ctx,
      });
    } catch (err) {
      console.warn(
        `[prop_phase] auto-chain prop_image_phase failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }

    return {
      outcome,
      committed,
      failed,
      message: summaryText,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const propPhaseWorkflow = createWorkflow({
  id: "prop_phase",
  description:
    "道具阶段：从故事骨架 props 名册扩展出完整道具设计，草稿 → HITL → 入库。空名册时直接跳过。",
  inputSchema: PropPhaseInputSchema,
  outputSchema: PropPhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type PropPhaseOutput = z.infer<typeof PropPhaseOutputSchema>;
