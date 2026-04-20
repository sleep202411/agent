/**
 * role_phase — produce a committed character list from the project skeleton.
 *
 * Loads the Redis-cached story outline (written by story_outline workflow),
 * calls the roleDesigner Agent to elaborate each cast roster entry into a
 * full character design, then draft → HITL → batch commit to Java.
 *
 * Distinct from `role_design`, which invents characters from a short outline
 * string with no upstream material. `role_phase` always reads the skeleton
 * so its output is consistent with the rest of the pipeline.
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
import { reportProgress, startWorkflow, throwIfCancelled } from "../engine";
import { getContext } from "../../lib/workspace-client";
import { summarizeBatch } from "../../lib/batch-writer";
import { getOutline, type StoryOutline } from "../../lib/outline";
import { stylePaintingHint } from "../../lib/style-painting";
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
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string(), name: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), name: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  draftClientRefIds: z.array(z.string()).default([]),
  /** Map from clientRefId → character name for error reporting. */
  nameByRef: z.record(z.string(), z.string()).default({}),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  characterCount: z.number(),
  phase: z.literal("role"),
});

// ─── Step 0: resolve characters (from input or from skeleton) ────────

/**
 * Shape that downstream steps expect — always has a concrete characters[].
 */
const ResolvedInputSchema = z.object({
  worldId: z.string().min(1),
  characters: z.array(CharacterSchema).min(1),
});

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
      // Emit / update the single "planning" progress card — streams like
      // AI text until the phase transitions at suspend.
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
        name: entry.name, // force skeleton name (the agent may have drifted)
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
    for (const c of inputData.characters) {
      const clientRefId = randomUUID();
      const data: RoleCreateData = {
        worldId: inputData.worldId,
        name: c.name,
        description: [`定位：${c.role}`, `外观：${c.appearance}`, `性格：${c.personality}`].join(
          "\n"
        ),
        // Use the dedicated image-gen prompt (visual-token optimized) rather
        // than reusing `appearance` (which reads human but may lack style /
        // lighting / composition tokens needed for consistent images).
        prompt: c.prompt,
        roleImgPath: [],
        referenceImgPath: [],
        referenceImgDescription: [],
        model: "",
        voiceId: "",
      };
      await putDraft(runId, "role", clientRefId, data);
      draftClientRefIds.push(clientRefId);
      nameByRef[clientRefId] = c.name;
      i += 1;
      await reportProgress(runId, {
        stepId: "role_phase.collect",
        current: i,
        total: inputData.characters.length,
        label: `已收集 ${i}/${inputData.characters.length} 个角色草稿`,
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
        stepId: "role_phase.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `已生成 ${inputData.draftCount} 个角色，等待确认后进入下一阶段`,
      });
      // Build the draft-preview group for the suspended card.
      const drafts = await listDrafts<RoleCreateData>(runId, {
        entityType: "role",
        statuses: ["pending"],
      });
      const items = drafts.map((d) => ({
        clientRefId: d.clientRefId,
        data: d.data as unknown as Record<string, unknown>,
      }));
      await publishWorkflowSuspended(ctx.projectId, runId, "role_phase", {
        draftGroups: [
          {
            entityType: "role",
            count: items.length,
            items,
          },
        ],
        totalDraftCount: items.length,
      });
      return await suspend({
        runId,
        characterCount: inputData.draftCount,
        phase: "role" as const,
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
  outputSchema: RolePhaseOutputSchema,
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
      await publishWorkflowFailed(ctx.projectId, runId, "role_phase", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `角色阶段未通过。反馈：${inputData.feedback}`
          : "角色阶段未通过。",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<RoleCreateData>(runId, {
      entityType: "role",
      statuses: ["pending"],
    });
    const items = drafts
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

    const committed: RolePhaseOutput["committed"] = [];
    const failed: RolePhaseOutput["failed"] = [];
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

    // Image generation is NOT dispatched here anymore — it's a separate
    // workflow (`role_image_phase`) so the user can review / tweak the
    // committed role text before image jobs start. See apps/agent/src/
    // mastra/workflows/phases/role-image-phase.ts.

    const summaryText =
      outcome === "committed"
        ? `已入库 ${committed.length} 个角色，进入下一阶段。`
        : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`;

    await publishWorkflowCompleted(ctx.projectId, runId, "role_phase", {
      committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summary: summaryText,
      // Compact chip — image phase's progress card takes the "big" slot.
      compact: true,
      // No nextStep — image gen is purely mechanical (no user decision),
      // so we auto-chain role_image_phase below instead of showing a
      // "继续·出图" button the user would always just click through.
    });

    // Auto-chain: text-phase commit is done, kick off the image phase
    // for whatever got committed. Partial failure is fine — image phase
    // generates for what's in the DB and surfaces its own failures; a true
    // hard failure would throw before this point and the user gets the
    // retry button on the workflow_failed card instead.
    //
    // Skip the auto-chain when running INSIDE main_flow — main_flow's
    // .then(roleImagePhaseWorkflow) step already runs the image phase
    // next, and a standalone startWorkflow() here would spawn a SECOND
    // parallel image run (duplicate cards, duplicate Java dispatch).
    const inMainFlow = requestContext?.get("inMainFlow") === true;
    if (!inMainFlow) {
      try {
        await startWorkflow({
          workflowName: "role_image_phase",
          inputData: {},
          ctx,
        });
      } catch (err) {
        console.warn(
          `[role_phase] auto-chain role_image_phase failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
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

export const rolePhaseWorkflow = createWorkflow({
  id: "role_phase",
  description:
    "角色阶段：从故事骨架（或 caller 提供的 characters 列表）扩展出完整角色设计，草稿 → HITL → 入库。",
  inputSchema: RolePhaseInputSchema,
  outputSchema: RolePhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type RolePhaseOutput = z.infer<typeof RolePhaseOutputSchema>;
