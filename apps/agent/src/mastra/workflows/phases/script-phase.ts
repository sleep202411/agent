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
import { contentLanguageInstruction, resolveContentLanguage } from "../../lib/language";
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

    const startLabel = `Scriptwriter drafting scripts (${total} episodes)`;
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
      const label = `Generated ${completed}/${total} episodes (${totalChars} chars)`;
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
    (c) => `- **${c.name}** (${c.role})${c.personality ? ` — ${c.personality.slice(0, 80)}` : ""}`
  );
  return `\nCast (dialogue and actions must match each character's voice):\n${lines.join("\n")}\n`;
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
      return "Simplified Chinese";
    case "zh-HK":
      return "Traditional Chinese";
    case "en-US":
      return "English";
    default:
      return code || "English";
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
  const meta = [genre ? `Genre: ${genre}` : "", tone ? `Tone: ${tone}` : ""]
    .filter(Boolean)
    .join(" / ");
  const langLabel = dialogLanguageLabel(dialogLanguage);

  return [
    `Write a fully shootable short-drama episode script — Episode ${index}/${total}.`,
    meta,
    "",
    "Story main thread:",
    storySummary,
    castBlock,
    "Episode title: " + episode.title,
    episode.introduction ? "Episode outline: " + episode.introduction : "",
    "",
    "Output language: dialogue and narration in **" +
      langLabel +
      "**. Visuals and SFX cues may be in English; dialogue strictly in the dialogue language.",
    "",
    "Requirements:",
    `- **All dialogue and narration must be in ${langLabel}**.`,
    '- Follow the persona\'s "timecode shooting-script format" strictly: episode title on the first line, then time blocks marked `0:00-0:15` etc.; within each block put `[VISUAL]` (or `【画面】` for Chinese locales) / `[SFX/AMBIENT]` (or `【音效/环境】`) / dialogue each on its own line.',
    "- Total runtime 1-3 minutes, typically 4-8 time blocks, each 10-30 seconds = 30-150 characters / ~20-100 English words.",
    "- Block 1 (first 15s) must anchor the scene and drop a hook; the final block needs a strong cliffhanger.",
    "- Every episode needs at least one signature image (close-up / held look / slow shot of a key prop).",
    "- SFX onomatopoeia in UPPERCASE (TINKS / RUSTLES / KNOCKS, etc.) to build atmosphere.",
    "- Every line must carry subtext AND do one of: drive plot / reveal character / create conflict (cut anything that does none).",
    "",
    'Return JSON: `{"content": "...full script text, with real newlines as \\\\n..."}`. No Markdown code fences, no preamble.',
    contentLanguageInstruction(resolveContentLanguage(dialogLanguage)),
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
      label: `Scripts ready for review: ${inputData.generatedCount} episodes (${inputData.totalChars} chars)`,
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
      message: `Generated ${inputData.generatedCount} script drafts — awaiting review.`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptPhaseWorkflow = createWorkflow({
  id: "script_phase",
  description:
    "Script phase: call scriptwriter per episode → stash drafts in Redis → await user confirmation. On accept, apply_phase_drafts batch-saves to Java.",
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
      error: feedback ? `User requested changes: ${feedback}` : "User rejected.",
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
      message: feedback ? `Script phase rejected. Feedback: ${feedback}` : "Script phase rejected.",
      completion: null,
      failure: failurePayload,
    };
  }

  const accepted = acceptedClientRefIds ? new Set(acceptedClientRefIds) : null;
  const accepts = pending.filter((d) => !accepted || accepted.has(d.clientRefId));

  for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `Saving ${accepts.length} episode scripts…`;
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

  const endLabel = `Scripts saved: ${committed.length} succeeded / ${failed.length} failed`;
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

  const summaryKey = totalFailure
    ? "scriptPhaseSummaryTotalFailure"
    : outcome === "committed"
      ? "scriptPhaseSummaryCommitted"
      : "scriptPhaseSummaryPartial";
  const summaryParams = {
    count: committed.length,
    failed: failed.length,
    total: accepts.length,
  };
  const logMessage = totalFailure
    ? `total failure: ${failed.length}/${accepts.length}`
    : outcome === "committed"
      ? `committed ${committed.length} scripts`
      : `partial: ${committed.length}/${accepts.length}, ${failed.length} failed`;

  if (totalFailure) {
    const firstReason = failed[0]?.reason ?? "Java batch write failed entirely";
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "script_phase",
      terminalStatus: "failed",
      // User-facing error is rendered by the workflow failure card, which
      // also has its own locale-aware rendering; we just pass a compact
      // English log-style string here.
      error: `${logMessage} (first reason: ${firstReason})`,
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
      message: logMessage,
      completion: null,
      failure: failurePayload,
    };
  }

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "script_phase",
    committed: committed.map((c) => ({ serverId: c.episodeId, title: c.title })),
    failed: failed.map((f) => ({ clientRefId: f.episodeId, reason: f.reason })),
    summaryKey,
    summaryParams,
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
