/**
 * episode_phase — plan N episodes via the episode-planner persona, emit
 * drafts for review, and end. Commit via `applyEpisodeDrafts()`.
 *
 * Reads from the project skeleton (Redis outline:{projectId}, written by
 * story_outline) for storySummary + cast roster + chapter structure +
 * genre/tone. Call with targetEpisodeCount + optional feedback only.
 *
 * Java endpoint `/api/user/world/batch/updateOrAdd/episode` accepts a list of
 * {title, introduction, frontPrompt, behindPrompt, sort, projectId} entries.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { robustStructuredGenerate } from "../../lib/robust-generate";
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
import { type StoryOutline } from "../../lib/outline";
import { ensureOutline } from "../../lib/outline-deps";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";
import { publishEntityEvent } from "../../lib/entity-events";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import { contentLanguageInstruction, resolveContentLanguage } from "../../lib/language";
import type { WorkflowCompletedOutput, WorkflowFailedOutput } from "@repo/shared";

// ─── Schemas ───────────────────────────────────────────────────────────

const EpisodePlan = z.object({
  title: z.string().min(1).max(30),
  introduction: z.string().min(30).max(400),
  frontPrompt: z.string().optional(),
  behindPrompt: z.string().optional(),
});

export const EpisodePhaseInputSchema = z.object({
  projectId: z.string().min(1),
  targetEpisodeCount: z.number().int().min(1).max(60),
  /** User feedback from a prior revise round — steers the planner. */
  feedback: z.string().optional(),
});

export const EpisodePhaseOutputSchema = z.object({
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
});

/** Internal — resolved from skeleton before plan runs. */
const ResolvedPlanInputSchema = z.object({
  projectId: z.string(),
  storySummary: z.string(),
  characters: z.array(z.object({ name: z.string(), role: z.string() })).default([]),
  targetEpisodeCount: z.number().int().min(1).max(60),
  genre: z.string().optional(),
  tone: z.string().optional(),
  structure: z
    .array(
      z.object({
        chapterId: z.string(),
        title: z.string(),
        summary: z.string(),
        keyEvents: z.array(z.string()),
      })
    )
    .optional(),
  feedback: z.string().optional(),
  /** Output language for episode titles / introductions. */
  contentLanguage: z.string().optional(),
});

const PlannedSchema = z.object({
  episodes: z.array(EpisodePlan),
  projectId: z.string(),
});

// Draft payload shape stored in Redis — consumed by applyEpisodeDrafts.
interface EpisodeDraftData {
  title: string;
  introduction: string;
  frontPrompt: string;
  behindPrompt: string;
  sortHint: number;
  projectId: string;
}

// ─── Step 0: resolve inputs from skeleton ─────────────────────────────

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: EpisodePhaseInputSchema,
  outputSchema: ResolvedPlanInputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const record = await ensureOutline(ctx.projectId, { requiredBy: "episode_phase" });
    const skeleton: StoryOutline = record.outline;
    return {
      projectId: inputData.projectId,
      storySummary: skeleton.storySummary,
      characters: skeleton.cast.map((c) => ({ name: c.name, role: c.role })),
      targetEpisodeCount: inputData.targetEpisodeCount,
      genre: skeleton.genre,
      tone: skeleton.tone,
      structure: skeleton.structure.map((ch) => ({
        chapterId: ch.chapterId,
        title: ch.title,
        summary: ch.summary,
        keyEvents: ch.keyEvents,
      })),
      feedback: inputData.feedback,
      contentLanguage: ctx.dialogLanguage,
    };
  },
});

// ─── Step 1: plan episodes (LLM) ──────────────────────────────────────

const planStep = createStep({
  id: "plan",
  inputSchema: ResolvedPlanInputSchema,
  outputSchema: PlannedSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);
    const ctx = getContext(requestContext);

    const startLabel = "Episode planner is drafting episodes…";
    await reportProgress(runId, {
      stepId: "episode_phase.plan",
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "episode_phase", "planning", {
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });

    const planner = mastra?.getAgent("episodePlanner");
    if (!planner) throw new Error("episode-planner agent not registered");

    // Robust 2-try + raw-dump pattern — DeepSeek occasionally returns a
    // bare array instead of the `{episodes: [...]}` wrapper, which makes
    // Mastra's structuredOutput parse fail silently. The helper retries
    // with a strict JSON-only postfix and dumps raw on failure.
    const plannerSchema = z.object({ episodes: z.array(EpisodePlan) });
    const { object: plannerOutput } = await robustStructuredGenerate({
      agent: planner,
      prompt: buildPrompt(inputData),
      schema: plannerSchema,
      tag: `episode-planner-${runId}`,
      isEmpty: (obj) => !obj?.episodes || obj.episodes.length === 0,
    });
    const episodes = plannerOutput.episodes.slice(0, inputData.targetEpisodeCount);

    const doneLabel = `${episodes.length} episode outlines planned`;
    await reportProgress(runId, {
      stepId: "episode_phase.plan",
      current: episodes.length,
      total: inputData.targetEpisodeCount,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "episode_phase", "planning", {
      current: episodes.length,
      total: inputData.targetEpisodeCount,
      label: doneLabel,
    });
    return { episodes, projectId: inputData.projectId };
  },
});

function buildPrompt(input: z.infer<typeof ResolvedPlanInputSchema>): string {
  const cast = input.characters.map((c) => `- ${c.name} (${c.role})`).join("\n");
  const chapterBlock = input.structure?.length
    ? [
        "",
        "Source chapter skeleton (reference; redivide reasonably into episodes — does not need to be 1-to-1):",
        input.structure
          .map((ch) =>
            [
              `- ${ch.chapterId} "${ch.title}": ${ch.summary}`,
              ch.keyEvents.length ? `  Key events: ${ch.keyEvents.join("; ")}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          )
          .join("\n"),
      ].join("\n")
    : "";
  const feedbackBlock = input.feedback
    ? `\n\n[User feedback (must take precedence)]\n${input.feedback}\n`
    : "";
  const parts = [
    `Target episode count: ${input.targetEpisodeCount}`,
    input.genre ? `Genre: ${input.genre}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
    "",
    "Story main thread:",
    input.storySummary,
    "",
    cast ? `Cast:\n${cast}` : "",
    chapterBlock,
    feedbackBlock,
    "",
    `Output exactly ${input.targetEpisodeCount} episode outlines as a JSON array under \`episodes\`. Keep each \`introduction\` to ~30-80 English words / 80-200 Chinese characters.`,
    contentLanguageInstruction(resolveContentLanguage(input.contentLanguage)),
  ].filter(Boolean);
  return parts.join("\n");
}

// ─── Step 2: collect drafts into Redis ────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: PlannedSchema,
  outputSchema: z.object({ draftCount: z.number() }),
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    let i = 0;
    for (const ep of inputData.episodes) {
      const clientRefId = randomUUID();
      const data: EpisodeDraftData = {
        title: ep.title,
        introduction: ep.introduction,
        frontPrompt: ep.frontPrompt ?? "",
        behindPrompt: ep.behindPrompt ?? "",
        sortHint: i,
        projectId: inputData.projectId,
      };
      await putDraft(runId, "episode", clientRefId, data);
      i += 1;
      await reportProgress(runId, {
        stepId: "episode_phase.collect",
        current: i,
        total: inputData.episodes.length,
        label: `Collected ${i}/${inputData.episodes.length} episode drafts`,
      });
    }
    return { draftCount: i };
  },
});

// ─── Step 3: emit awaiting-review + end ───────────────────────────────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ draftCount: z.number() }),
  outputSchema: EpisodePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    await reportProgress(runId, {
      stepId: "episode_phase.review",
      current: inputData.draftCount,
      total: inputData.draftCount,
      label: `${inputData.draftCount} episode outlines generated — awaiting confirmation`,
    });

    const drafts = await listDrafts<EpisodeDraftData>(runId, {
      entityType: "episode",
      statuses: ["pending"],
    });
    await publishWorkflowSuspended(ctx.projectId, runId, "episode_phase", {
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
      estimatedCost: drafts.length * PRICES.episodePerUnit,
    });

    return {
      runId,
      draftCount: inputData.draftCount,
      message: `Generated ${inputData.draftCount} episode outline drafts — awaiting review.`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const episodePhaseWorkflow = createWorkflow({
  id: "episode_phase",
  description:
    "Episode phase: plan N episode outlines from the skeleton → stash drafts in Redis → wait for user confirmation. On accept, apply_phase_drafts batch-saves to Java.",
  inputSchema: EpisodePhaseInputSchema,
  outputSchema: EpisodePhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(planStep)
  .then(collectDraftsStep)
  .then(emitReviewStep)
  .commit();

// ─── Apply helper ──────────────────────────────────────────────────────

const SORT_GAP = 1024;

export interface ApplyEpisodeDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
  /** See role-phase.applyRoleDrafts for rationale. */
  emitLifecycleMessage?: boolean;
}

export interface ApplyEpisodeDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

export async function applyEpisodeDrafts(
  opts: ApplyEpisodeDraftsOptions
): Promise<ApplyEpisodeDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
  await throwIfCancelled(runId);

  const pending = await listDrafts<EpisodeDraftData>(runId, {
    entityType: "episode",
    statuses: ["pending"],
  });
  const titleByRef: Record<string, string> = {};
  for (const d of pending) titleByRef[d.clientRefId] = d.data.title;
  const pendingRefIds = pending.map((d) => d.clientRefId);
  // Project id comes from the drafts themselves (caller may not pass it).
  const projectId = pending[0]?.data.projectId ?? ctx.projectId;

  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.episodePerUnit,
      reason: `episode_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "episode_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "episode_phase",
      terminalStatus: "cancelled",
      error: feedback ? `User requested changes: ${feedback}` : "User rejected.",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "episode_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback
        ? `Episode phase rejected. Feedback: ${feedback}`
        : "Episode phase rejected.",
      completion: null,
      failure: failurePayload,
    };
  }

  const accepted = new Set(acceptedClientRefIds ?? pendingRefIds);
  const accepts = pending
    .filter((d) => accepted.has(d.clientRefId))
    .sort((a, b) => a.data.sortHint - b.data.sortHint);

  for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `Saving ${accepts.length} episodes…`;
  await reportProgress(runId, {
    stepId: "episode_phase.commit",
    current: 0,
    total: accepts.length,
    label: startLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "episode_phase", "committing", {
    current: 0,
    total: accepts.length,
    label: startLabel,
  });

  const datas = accepts.map((d, idx) => ({
    title: d.data.title,
    introduction: d.data.introduction,
    frontPrompt: d.data.frontPrompt,
    behindPrompt: d.data.behindPrompt,
    projectId,
    sort: (idx + 1) * SORT_GAP,
  }));

  const committed: Array<{ serverId: string; title: string }> = [];
  const failed: Array<{ clientRefId: string; reason: string }> = [];

  try {
    await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
      data: { datas },
      timeoutMs: 120_000,
    });
    const listed = await javaRequest<{ list?: Array<{ id: string | number; sort?: number }> }>(
      ctx,
      "/api/user/world/list/episode",
      { data: { productId: projectId, page: 1, pageSize: 999 } }
    );
    const bySort = new Map((listed.list ?? []).map((ep) => [Number(ep.sort ?? 0), String(ep.id)]));
    for (let i = 0; i < accepts.length; i++) {
      const d = accepts[i];
      const sortKey = (i + 1) * SORT_GAP;
      const serverId = bySort.get(sortKey);
      if (serverId) {
        await markDraftCommitted(runId, d.clientRefId, serverId);
        committed.push({
          serverId,
          title: titleByRef[d.clientRefId] ?? d.data.title,
        });
      } else {
        await markDraftFailed(runId, d.clientRefId, "Java write succeeded but id lookup missed");
        failed.push({
          clientRefId: d.clientRefId,
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
        reason: message,
      });
    }
  }

  const outcome = failed.length === 0 ? ("committed" as const) : ("partial_failure" as const);
  if (failed.length === 0) await deleteAllDrafts(runId);

  if (committed.length > 0) {
    await publishEntityEvent(ctx, {
      entity: "episode",
      action: "batch_created",
      source: "episode_phase",
    });
  }

  const endLabel = `Episodes committed: ${committed.length} ok / ${failed.length} failed`;
  await reportProgress(runId, {
    stepId: "episode_phase.commit",
    current: committed.length,
    total: accepts.length,
    label: endLabel,
  });
  await publishWorkflowProgress(ctx.projectId, runId, "episode_phase", "committing", {
    current: committed.length,
    total: accepts.length,
    label: endLabel,
  });

  const summaryKey =
    outcome === "committed" ? "episodePhaseSummaryCommitted" : "episodePhaseSummaryPartial";
  const summaryParams = {
    count: committed.length,
    failed: failed.length,
    total: accepts.length,
  };
  const logMessage =
    outcome === "committed"
      ? `committed ${committed.length} episodes`
      : `partial failure: ${failed.length}/${accepts.length}`;

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "episode_phase",
    committed: committed.map((c) => ({ serverId: c.serverId, title: c.title })),
    failed,
    summaryKey,
    summaryParams,
    nextSteps: [
      {
        workflowName: "script_phase",
        labelKey: "workflowNextContinueToScripts",
        variant: "primary",
        // Scope script generation to the episodes we just committed.
        // Without this, script_phase fetches EVERY episode in the project
        // from Java and writes scripts for all of them — wrong after any
        // earlier episode_phase run left behind episodes.
        inputData: { episodeIds: committed.map((c) => c.serverId) },
      },
    ],
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "episode_phase", {
      committed: completionPayload.committed,
      failed: completionPayload.failed,
      summaryKey: completionPayload.summaryKey,
      summaryParams: completionPayload.summaryParams,
      nextSteps: completionPayload.nextSteps,
    });
  }

  return {
    outcome,
    committedCount: committed.length,
    failedCount: failed.length,
    message: logMessage,
    completion: completionPayload,
    failure: null,
  };
}
