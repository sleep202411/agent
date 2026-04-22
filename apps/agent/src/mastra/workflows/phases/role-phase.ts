/**
 * role_phase — produce role drafts and end.
 *
 * Post-Stage-C: generate drafts → publish workflow_suspended event → END.
 * No Mastra suspend/resume. Commit via `applyRoleDrafts()`.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertRoles, type RoleCreateData } from "../../lib/batch-writers/world-assets";
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
import { stylePaintingHint } from "../../lib/style-painting";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";

// ─── Schemas ───────────────────────────────────────────────────────────

const CharacterSchema = z.object({
  name: z.string().min(1).max(20),
  role: z.string().min(1),
  appearance: z.string().min(1),
  personality: z.string().min(1),
  /**
   * Image-generation prompt — distinct from `appearance`, which is a
   * human-readable description. `prompt` is a visual-token-optimized string
   * passed directly to the image model (Tongyi / Stable Diffusion variants).
   */
  prompt: z.string().min(1),
});

export const RolePhaseInputSchema = z.object({
  worldId: z.string().min(1),
  /** User feedback from a prior revise round — steers roleDesigner. */
  feedback: z.string().optional(),
});

export const RolePhaseOutputSchema = z.object({
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
});

const ResolvedInputSchema = z.object({
  worldId: z.string().min(1),
  characters: z.array(CharacterSchema).min(1),
});

// ─── Step 0: resolve characters from skeleton ────────────────────────

function buildElaboratePrompt(
  skeleton: StoryOutline,
  entry: StoryOutline["cast"][number],
  feedback?: string,
  stylePainting?: string
): string {
  const chapterRefs = entry.firstAppearance
    ? skeleton.structure
        .filter((ch) => ch.chapterId === entry.firstAppearance)
        .map((ch) => `- ${ch.chapterId} 《${ch.title}》：${ch.summary}`)
        .join("\n")
    : "";
  const feedbackBlock = feedback ? `\n\n【用户补充意见（优先遵循）】\n${feedback}\n` : "";
  return [
    "请基于下面的故事骨架与角色名册条目，产出**一个完整角色设计**（JSON）。",
    "",
    "## 故事概况",
    `类型：${skeleton.genre} / 基调：${skeleton.tone}`,
    `主线：${skeleton.threads.main}`,
    `摘要：${skeleton.storySummary}`,
    "",
    "## 这个角色在骨架里的信息",
    `- 姓名：${entry.name}`,
    `- 功能定位：${entry.role}`,
    `- 角色弧线：${entry.arc}`,
    entry.firstAppearance ? `- 首次出场：${entry.firstAppearance}` : "",
    chapterRefs ? `\n相关章节：\n${chapterRefs}` : "",
    feedbackBlock,
    "",
    "## 你产出的字段（都是 string）",
    "- name：沿用骨架里给的姓名，不要改",
    "- role：沿用骨架里给的功能定位，不要改",
    "- appearance：15-40 字**人读**的外貌描述。发型、服饰、体态、显著视觉标志，用顿号连接",
    "- personality：20-50 字性格 + 说话风格 + 典型行为，紧扣 arc 给的成长弧线",
    "- prompt：**图像生成提示词**。和 appearance 不同，这是直接喂给图像模型的 prompt —— **60-120 字**、中文顿号 `、` 分隔的视觉关键词串，按「主体（年龄+性别+人种/种族）+ 体型 + 发型发色 + 眼神/表情 + 服装（**颜色+材质**，至少 2 项）+ 标志物/伤疤/配件（至少 1 项）+ 气质神态 + 镜头（胸像/半身/特写）」顺序排。**不要**写故事背景 / 情节 / 情感；只写画面上能看到的东西。**不要**加画风/品质 token（写实、电影感、高清、8K、4k、cartoon 这类）—— 下游会根据项目选定画风统一拼接。与 appearance 的视觉信息保持一致但扩充细节到图像模型能画出稳定外观。",
    stylePaintingHint(stylePainting),
  ]
    .filter(Boolean)
    .join("\n");
}

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: RolePhaseInputSchema,
  outputSchema: ResolvedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const ctx = getContext(requestContext);
    const record = await getOutline(ctx.projectId);
    if (!record) {
      throw new Error(
        `role_phase: no story outline cached for project ${ctx.projectId}. Run story_outline first.`
      );
    }
    const roleDesigner = mastra?.getAgent("roleDesigner");
    if (!roleDesigner) throw new Error("roleDesigner agent not registered");

    const cast = record.outline.cast ?? [];
    if (cast.length === 0) {
      throw new Error("role_phase: story outline has empty cast roster");
    }

    const characters: z.infer<typeof CharacterSchema>[] = [];
    for (let i = 0; i < cast.length; i++) {
      const entry = cast[i];
      await throwIfCancelled(runId);
      const label = `角色设计师正在扩展「${entry.name}」…`;
      await reportProgress(runId, {
        stepId: "role_phase.elaborate",
        current: i,
        total: cast.length,
        label,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "role_phase", "planning", {
        current: i,
        total: cast.length,
        label,
      });
      const prompt = buildElaboratePrompt(
        record.outline,
        entry,
        inputData.feedback,
        ctx.stylePainting
      );
      const response = await roleDesigner.generate(prompt, {
        structuredOutput: {
          schema: CharacterSchema,
          errorStrategy: "strict",
        },
      });
      const designed = response.object as z.infer<typeof CharacterSchema> | undefined;
      if (!designed) {
        throw new Error(`roleDesigner returned no design for ${entry.name}`);
      }
      characters.push({
        name: entry.name,
        role: entry.role,
        appearance: designed.appearance,
        personality: designed.personality,
        prompt: designed.prompt,
      });
    }
    const doneLabel = `角色设计完成：${cast.length} 位`;
    await reportProgress(runId, {
      stepId: "role_phase.elaborate",
      current: cast.length,
      total: cast.length,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "role_phase", "planning", {
      current: cast.length,
      total: cast.length,
      label: doneLabel,
    });
    return { worldId: inputData.worldId, characters };
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
    for (const c of inputData.characters) {
      const clientRefId = randomUUID();
      const data: RoleCreateData = {
        worldId: inputData.worldId,
        name: c.name,
        description: [`定位：${c.role}`, `外观：${c.appearance}`, `性格：${c.personality}`].join(
          "\n"
        ),
        prompt: c.prompt,
        roleImgPath: [],
        referenceImgPath: [],
        referenceImgDescription: [],
        model: "",
        voiceId: "",
      };
      await putDraft(runId, "role", clientRefId, data);
      i += 1;
      await reportProgress(runId, {
        stepId: "role_phase.collect",
        current: i,
        total: inputData.characters.length,
        label: `已收集 ${i}/${inputData.characters.length} 个角色草稿`,
      });
    }
    return { draftCount: i };
  },
});

// ─── Step 2: emit awaiting-review event + end ─────────────────────────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ draftCount: z.number() }),
  outputSchema: RolePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    await reportProgress(runId, {
      stepId: "role_phase.review",
      current: inputData.draftCount,
      total: inputData.draftCount,
      label: `已生成 ${inputData.draftCount} 个角色，等待确认后进入下一阶段`,
    });

    const drafts = await listDrafts<RoleCreateData>(runId, {
      entityType: "role",
      statuses: ["pending"],
    });
    await publishWorkflowSuspended(ctx.projectId, runId, "role_phase", {
      draftGroups: [
        {
          entityType: "role",
          count: drafts.length,
          items: drafts.map((d) => ({
            clientRefId: d.clientRefId,
            data: d.data as unknown as Record<string, unknown>,
          })),
        },
      ],
      totalDraftCount: drafts.length,
      estimatedCost: drafts.length * PRICES.rolePerUnit,
    });

    return {
      runId,
      draftCount: inputData.draftCount,
      message: `已生成 ${inputData.draftCount} 个角色草稿，等待确认。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const rolePhaseWorkflow = createWorkflow({
  id: "role_phase",
  description:
    "角色阶段：从故事骨架扩展 → 角色草稿入 Redis → 等用户确认。确认后走 apply_phase_drafts 入库，不走 Mastra resume。",
  inputSchema: RolePhaseInputSchema,
  outputSchema: RolePhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(emitReviewStep)
  .commit();

// ─── Apply helper (called from apply_phase_drafts tool + Nest /confirm) ─

export interface ApplyRoleDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
}

export interface ApplyRoleDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
}

export async function applyRoleDrafts(
  opts: ApplyRoleDraftsOptions
): Promise<ApplyRoleDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  await throwIfCancelled(runId);

  const pending = await listDrafts<RoleCreateData>(runId, {
    entityType: "role",
    statuses: ["pending"],
  });
  const nameByRef: Record<string, string> = {};
  for (const d of pending) nameByRef[d.clientRefId] = d.data.name;
  const pendingRefIds = pending.map((d) => d.clientRefId);

  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.rolePerUnit,
      reason: `role_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "role_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    await publishWorkflowFailed(ctx.projectId, runId, "role_phase", {
      terminalStatus: "cancelled",
      error: feedback ? `用户要求修改：${feedback}` : "用户未通过。",
      retryable: false,
    });
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `角色阶段未通过。反馈：${feedback}` : "角色阶段未通过。",
    };
  }

  const accepted = new Set(acceptedClientRefIds ?? pendingRefIds);
  const items = pending
    .filter((d) => accepted.has(d.clientRefId))
    .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

  for (const it of items) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `入库 ${items.length} 个角色…`;
  await reportProgress(runId, {
    stepId: "role_phase.commit",
    current: 0,
    total: items.length,
    label: startLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "role_phase", "committing", {
    current: 0,
    total: items.length,
    label: startLabel,
  });

  const results = await batchUpsertRoles(ctx, items, { concurrency: 1 });

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

  const endLabel = `角色入库完成：成功 ${committed.length} / 失败 ${failed.length}`;
  await reportProgress(runId, {
    stepId: "role_phase.commit",
    current: committed.length,
    total: items.length,
    label: endLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "role_phase", "committing", {
    current: committed.length,
    total: items.length,
    label: endLabel,
  });

  const summaryText =
    outcome === "committed"
      ? `已入库 ${committed.length} 个角色，进入下一阶段。`
      : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`;

  await publishWorkflowCompleted(ctx.projectId, runId, "role_phase", {
    committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
    failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
    summary: summaryText,
    nextSteps: [
      {
        workflowName: "role_image_phase",
        labelKey: "workflowNextContinueToRoleImages",
        variant: "primary",
      },
      {
        workflowName: "scene_phase",
        labelKey: "workflowNextSkipToScenes",
        variant: "secondary",
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
