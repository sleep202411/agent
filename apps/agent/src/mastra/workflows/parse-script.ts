/**
 * parse_script — slice a user-uploaded 剧本 into N episode entries + script
 * content, commit to Java.
 *
 * Use case: user uploaded a finished script (not a novel/synopsis). We
 * don't want to re-write it through script_breakdown → episode_phase →
 * script_phase (which would *generate* new text from scratch and drop
 * the user's original). Instead, keep the original verbatim; just split
 * it into episodes along natural 章/场/幕 boundaries.
 *
 * Flow:
 *   1. resolve_input     — echo through + number source lines
 *   2. split             — scriptSplitter persona returns
 *                          [{title, introduction, startLine, endLine}]
 *   3. collect_drafts    — slice source by line ranges, write one draft
 *                          per episode (title + intro + verbatim content)
 *   4. wait_confirmation — HITL (user can rename / drop splits)
 *   5. apply_decision    — Java: batch/updateOrAdd/episode + then
 *                          scripts/episode/batch/createOrUpdate
 *
 * Distinct from episode_phase + script_phase because:
 *   - no LLM creative writing (content is verbatim from source)
 *   - no story outline required (no Redis outline:{projectId} dependency)
 *   - one HITL gate instead of two (episode + script combined)
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
} from "../lib/drafts";
import { reportProgress, throwIfCancelled } from "./engine";
import { getContext, javaRequest } from "../lib/workspace-client";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../lib/workflow-messages";
import { PRICES, deductCredits, phaseDeductKey } from "../lib/billing";

// ─── Schemas ───────────────────────────────────────────────────────────

export const ParseScriptInputSchema = z.object({
  projectId: z.string().min(1),
  /** Raw script text. Resolved from textRef by invoke_workflow. */
  text: z.string().min(1),
  /** Target number of episodes to split into. */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
  /** Optional user feedback for a revise pass. */
  feedback: z.string().optional(),
});

const SplitEntry = z.object({
  title: z.string().min(1).max(30),
  introduction: z.string().min(1).max(400),
  /** 1-based inclusive line number (into the source). */
  startLine: z.coerce.number().int().min(1),
  endLine: z.coerce.number().int().min(1),
});

export const ParseScriptOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ serverId: z.string(), title: z.string(), chars: z.number() })),
  failed: z.array(z.object({ clientRefId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const DraftShape = z.object({
  title: z.string(),
  introduction: z.string(),
  content: z.string(),
  sortHint: z.number(),
});

const StateSchema = z.object({
  draftClientRefIds: z.array(z.string()).default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  phase: z.literal("parse_script"),
});

// ─── Step 1: split (LLM) ──────────────────────────────────────────────

const splitStep = createStep({
  id: "split",
  inputSchema: ParseScriptInputSchema,
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);
    const ctx = getContext(requestContext);

    const splitter = mastra?.getAgent("scriptSplitter");
    if (!splitter) throw new Error("scriptSplitter agent not registered");

    // Normalize line endings, trim trailing whitespace per line (preserves
    // intentional blank-line paragraphs which carry structural meaning).
    const rawLines = inputData.text.replace(/\r\n/g, "\n").split("\n");
    const totalLines = rawLines.length;

    const startLabel = `剧本切分师开始切分（共 ${totalLines} 行 → 目标 ${inputData.targetEpisodeCount} 集）`;
    await reportProgress(runId, {
      stepId: "parse_script.split",
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "planning", {
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });

    const numbered = rawLines.map((l, i) => `${i + 1}: ${l}`).join("\n");
    const feedbackBlock = inputData.feedback
      ? `\n\n【用户修改意见（优先遵循）】\n${inputData.feedback}\n`
      : "";
    const prompt = [
      `目标集数：${inputData.targetEpisodeCount}`,
      `总行数 totalLines：${totalLines}`,
      "",
      "带行号的剧本全文：",
      "```",
      numbered,
      "```",
      feedbackBlock,
      "",
      `请严格返回 ${inputData.targetEpisodeCount} 条 episodes，每条的 startLine/endLine 必须闭区间、严格衔接、落在 [1, ${totalLines}] 内。`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await splitter.generate(prompt, {
      structuredOutput: {
        schema: z.object({ episodes: z.array(SplitEntry) }),
        errorStrategy: "strict",
      },
    });
    const rawEpisodes =
      (response.object as { episodes?: z.infer<typeof SplitEntry>[] } | undefined)?.episodes ?? [];
    if (rawEpisodes.length === 0) {
      throw new Error("scriptSplitter 未返回任何 episodes");
    }

    // Clamp line ranges to [1, totalLines] and enforce strict ordering —
    // DeepSeek occasionally returns overlapping / reversed ranges when
    // the script is dense with scene headers.
    const clamped = rawEpisodes
      .map((e) => ({
        title: e.title.trim(),
        introduction: e.introduction.trim(),
        startLine: Math.max(1, Math.min(totalLines, Math.floor(e.startLine))),
        endLine: Math.max(1, Math.min(totalLines, Math.floor(e.endLine))),
      }))
      .filter((e) => e.endLine >= e.startLine)
      .sort((a, b) => a.startLine - b.startLine)
      .slice(0, inputData.targetEpisodeCount);

    if (clamped.length === 0) {
      throw new Error("所有返回的 episodes 行号都不合法，切分失败");
    }

    // Stitch gaps: if episode i ends before episode i+1 starts - 1, extend
    // i's endLine to cover the gap. If i ends past i+1's start, trim i
    // back to i+1.startLine - 1. First episode always starts at 1; last
    // always ends at totalLines (no missing trailer).
    const stitched: Array<{
      title: string;
      introduction: string;
      startLine: number;
      endLine: number;
    }> = [];
    for (let i = 0; i < clamped.length; i++) {
      const ep = { ...clamped[i] };
      if (i === 0) ep.startLine = 1;
      if (i === clamped.length - 1) ep.endLine = totalLines;
      if (i > 0) {
        const prev = stitched[i - 1];
        if (ep.startLine <= prev.endLine) ep.startLine = prev.endLine + 1;
        if (ep.endLine < ep.startLine) ep.endLine = ep.startLine;
      }
      stitched.push(ep);
    }
    // Second pass: make sure each ep's start is exactly prev.end + 1 (no gaps).
    for (let i = 1; i < stitched.length; i++) {
      const prev = stitched[i - 1];
      const curr = stitched[i];
      if (curr.startLine > prev.endLine + 1) {
        prev.endLine = curr.startLine - 1;
      }
    }

    // Slice + persist drafts.
    const draftClientRefIds: string[] = [];
    for (let i = 0; i < stitched.length; i++) {
      const ep = stitched[i];
      // rawLines is 0-indexed; startLine/endLine are 1-based inclusive.
      const content = rawLines
        .slice(ep.startLine - 1, ep.endLine)
        .join("\n")
        .trim();
      const clientRefId = randomUUID();
      await putDraft(runId, "episode", clientRefId, {
        title: ep.title,
        introduction: ep.introduction,
        content,
        sortHint: i,
      });
      draftClientRefIds.push(clientRefId);
    }

    setState({ draftClientRefIds });

    const doneLabel = `已切分为 ${stitched.length} 集草稿，等待确认`;
    await reportProgress(runId, {
      stepId: "parse_script.split",
      current: stitched.length,
      total: stitched.length,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "planning", {
      current: stitched.length,
      total: stitched.length,
      label: doneLabel,
    });

    return { draftCount: stitched.length };
  },
});

// ─── Step 2: HITL ─────────────────────────────────────────────────────

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
        stepId: "parse_script.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} 集已切分，等待确认`,
      });
      const drafts = await listDrafts<z.infer<typeof DraftShape>>(runId, {
        entityType: "episode",
        statuses: ["pending"],
      });
      // No nextAction — after approval parse_script's completion emits a
      // 2-option nextSteps card (完整资产 vs 直接分镜) for the user to pick
      // downstream. The suspended card button should just be "完成 · N 积分"
      // (approve current drafts + commit), not "继续 xxx" which misleads
      // into thinking the next phase runs immediately.
      await publishWorkflowSuspended(ctx.projectId, runId, "parse_script", {
        draftGroups: [
          {
            entityType: "episode",
            count: drafts.length,
            items: drafts.map((d) => ({
              clientRefId: d.clientRefId,
              data: d.data as unknown as Record<string, unknown>,
            })),
          },
        ],
        totalDraftCount: drafts.length,
        estimatedCost: drafts.length * PRICES.parseScriptPerEpisode,
      });
      return await suspend({
        runId,
        episodeCount: inputData.draftCount,
        phase: "parse_script" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 3: commit (episodes + scripts, batched) ─────────────────────

const SORT_GAP = 1024;

function scriptToTiptapHtml(text: string): string {
  if (!text) return "";
  const escaped = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escaped(line)}</p>`);
  return paragraphs.join("\n");
}

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: ParseScriptOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const rawInput = getInitData<z.infer<typeof ParseScriptInputSchema>>();
    const projectId = rawInput.projectId || ctx.projectId;
    const draftClientRefIds = state.draftClientRefIds ?? [];

    // Charge regardless of approved/rejected — LLM cost incurred at split.
    if (draftClientRefIds.length > 0) {
      await deductCredits(ctx, {
        amount: draftClientRefIds.length * PRICES.parseScriptPerEpisode,
        reason: `parse_script ${draftClientRefIds.length} drafts (approved=${inputData.approved})`,
        idempotencyKey: phaseDeductKey(runId, "parse_script"),
      });
    }

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      await publishWorkflowFailed(ctx.projectId, runId, "parse_script", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback ? `切分未通过。反馈：${inputData.feedback}` : "切分未通过。",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<z.infer<typeof DraftShape>>(runId, {
      entityType: "episode",
      statuses: ["pending"],
    });
    const accepts = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .sort((a, b) => a.data.sortHint - b.data.sortHint);

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

    // ── Phase A: batch upsert episode metadata ──
    const episodeStartLabel = `入库 ${accepts.length} 集元信息…`;
    await reportProgress(runId, {
      stepId: "parse_script.commit.episodes",
      current: 0,
      total: accepts.length,
      label: episodeStartLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
      current: 0,
      total: accepts.length,
      label: episodeStartLabel,
    });

    const episodeDatas = accepts.map((d, idx) => ({
      title: d.data.title,
      introduction: d.data.introduction,
      frontPrompt: "",
      behindPrompt: "",
      projectId,
      sort: (idx + 1) * SORT_GAP,
    }));

    const committed: z.infer<typeof ParseScriptOutputSchema>["committed"] = [];
    const failed: z.infer<typeof ParseScriptOutputSchema>["failed"] = [];
    const serverIdByDraftRef = new Map<string, string>();

    try {
      await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
        data: { datas: episodeDatas },
        timeoutMs: 120_000,
      });
      const listed = await javaRequest<{ list?: Array<{ id: string | number; sort?: number }> }>(
        ctx,
        "/api/user/world/list/episode",
        { data: { productId: projectId, page: 1, pageSize: 999 } }
      );
      const bySort = new Map(
        (listed.list ?? []).map((ep) => [Number(ep.sort ?? 0), String(ep.id)])
      );
      for (let i = 0; i < accepts.length; i++) {
        const d = accepts[i];
        const sortKey = (i + 1) * SORT_GAP;
        const serverId = bySort.get(sortKey);
        if (serverId) {
          serverIdByDraftRef.set(d.clientRefId, serverId);
        } else {
          await markDraftFailed(
            runId,
            d.clientRefId,
            "Episode insert succeeded but id lookup missed"
          );
          failed.push({
            clientRefId: d.clientRefId,
            title: d.data.title,
            reason: "id lookup missed",
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const d of accepts) {
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          clientRefId: d.clientRefId,
          title: d.data.title,
          reason: message,
        });
      }
    }

    // ── Phase B: batch upsert script content (only for episodes that got
    // a serverId in Phase A) ──
    const toScript = accepts.filter((d) => serverIdByDraftRef.has(d.clientRefId));
    if (toScript.length > 0) {
      const scriptStartLabel = `入库 ${toScript.length} 集剧本正文…`;
      await reportProgress(runId, {
        stepId: "parse_script.commit.scripts",
        current: 0,
        total: toScript.length,
        label: scriptStartLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
        current: 0,
        total: toScript.length,
        label: scriptStartLabel,
      });

      const episodeIds = toScript.map((d) => serverIdByDraftRef.get(d.clientRefId)!);
      const contents = toScript.map((d) => scriptToTiptapHtml(d.data.content));

      try {
        await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/batch/createOrUpdate", {
          data: { projectId, episodeIds, contents },
          timeoutMs: 300_000,
        });
        for (const d of toScript) {
          const serverId = serverIdByDraftRef.get(d.clientRefId)!;
          await markDraftCommitted(runId, d.clientRefId, serverId);
          committed.push({
            serverId,
            title: d.data.title,
            chars: d.data.content.length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const d of toScript) {
          await markDraftFailed(runId, d.clientRefId, `script save failed: ${message}`);
          failed.push({
            clientRefId: d.clientRefId,
            title: d.data.title,
            reason: `script save failed: ${message}`,
          });
        }
      }
    }

    const outcome: z.infer<typeof ParseScriptOutputSchema>["outcome"] =
      failed.length === 0
        ? "committed"
        : committed.length === 0
          ? "partial_failure"
          : "partial_failure";

    if (failed.length === 0) await deleteAllDrafts(runId);

    const endLabel = `切分入库：成功 ${committed.length} / 失败 ${failed.length}`;
    await reportProgress(runId, {
      stepId: "parse_script.commit",
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });

    const summaryText =
      outcome === "committed"
        ? `已入库 ${committed.length} 集（含剧本正文），可以直接进入分镜阶段。`
        : `入库有失败：${failed.length} / ${accepts.length}。`;

    // After parse_script, user picks the downstream path:
    //   - 完整资产（角色 → 场景 → 道具 → 分镜）via story_outline
    //   - 直接出分镜（跳过角色/场景/道具 assets）via storyboard_phase
    // Replaces the former script_import_flow / script_to_storyboard_flow
    // parent workflows — LLM or button decides which branch.
    await publishWorkflowCompleted(ctx.projectId, runId, "parse_script", {
      committed: committed.map((c) => ({ serverId: c.serverId, title: c.title })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summary: summaryText,
      nextSteps: [
        {
          workflowName: "story_outline",
          labelKey: "workflowNextContinueToFullAssets",
          variant: "primary",
        },
        {
          workflowName: "storyboard_phase",
          labelKey: "workflowNextContinueToStoryboard",
          variant: "secondary",
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

export const parseScriptWorkflow = createWorkflow({
  id: "parse_script",
  description:
    "剧本切分：把用户上传的完整剧本按自然 场/幕/章 边界切成 N 集 → HITL → 入库 episode + script（原文照搬）。跳过 script_breakdown / script_phase。",
  inputSchema: ParseScriptInputSchema,
  outputSchema: ParseScriptOutputSchema,
  stateSchema: StateSchema,
})
  .then(splitStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type ParseScriptOutput = z.infer<typeof ParseScriptOutputSchema>;
