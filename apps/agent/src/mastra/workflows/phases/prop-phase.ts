/**
 * prop_phase — produce prop drafts and end.
 *
 * Post-Stage-C: generate drafts → publish workflow_suspended event → END.
 * No Mastra suspend/resume. Commit via `applyPropDrafts()`.
 *
 * Special case: if the story outline has no props roster, the phase emits
 * a "no_props" completion (no review needed) and ends immediately.
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

const PropDesignSchema = z.object({
  name: z.string().min(1).max(30),
  category: z
    .enum(["object", "document", "apparel", "vehicle", "weapon", "food", "art", "other"])
    .default("object"),
  era: z.string().default("contemporary"),
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
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
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
        .map((ch) => `- ${ch.chapterId} "${ch.title}": ${ch.summary}`)
        .join("\n")
    : "";
  const feedbackBlock = feedback ? `\n\n[User feedback (must be followed)]\n${feedback}\n` : "";
  return [
    "Based on the story skeleton and the prop roster entry below, produce **one complete prop design** as JSON.",
    "",
    "## Story snapshot",
    `Genre: ${skeleton.genre} / Tone: ${skeleton.tone}`,
    `Main thread: ${skeleton.threads.main}`,
    `Summary: ${skeleton.storySummary}`,
    "",
    "## This prop's roster entry",
    `- Name: ${entry.name}`,
    `- Type hint: ${entry.typeHint}`,
    entry.firstAppearance ? `- First appearance: ${entry.firstAppearance}` : "",
    chapterRefs ? `\nRelevant chapters:\n${chapterRefs}` : "",
    feedbackBlock,
    "",
    "Output language: default English. If the project context provides a `dialogLanguage` (or equivalent locale param), follow it.",
    "",
    "## Strictly follow the Prop Designer JSON schema; field meanings are in your system prompt.",
    "- name: keep the roster name verbatim, do not change it",
    "- appearance: 40-80 characters / ~25-50 English words; emphasize identifying details (for human readers)",
    "- significance: tied tightly to the prop's narrative function in the story",
    "- prompt: the **image-generation prompt** — 40-80 characters / ~25-50 English words of visual tokens, comma-separated in this order: prop subject, material, period feel, signs of use, close-up / still-life angle. Only paintable details. **Do not** add style/quality tokens (realistic, macro, cinematic, etc.) — the project's `stylePainting` is appended downstream. Do not write plot/emotional usage.",
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
      return { worldId: inputData.worldId, props: [] };
    }

    const props: z.infer<typeof PropDesignSchema>[] = [];
    for (let i = 0; i < propsRoster.length; i++) {
      const entry = propsRoster[i];
      await throwIfCancelled(runId);
      const label = `Prop Designer is elaborating "${entry.name}"…`;
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
    const doneLabel = `Prop design done: ${props.length}`;
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
    for (const p of inputData.props) {
      const clientRefId = randomUUID();
      const description = [
        `Type: ${p.category} · ${p.era}`,
        `Material: ${p.material}`,
        `Appearance: ${p.appearance}`,
        `Narrative function: ${p.significance}`,
        p.keyScenes.length > 0 ? `Key appearances: ${p.keyScenes.join("; ")}` : "",
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
      i += 1;
      await reportProgress(runId, {
        stepId: "prop_phase.collect",
        current: i,
        total: inputData.props.length,
        label: `Collected ${i}/${inputData.props.length} prop drafts`,
      });
    }
    return { draftCount: i };
  },
});

// ─── Step 2: emit awaiting-review event (or no-props completion) ──────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ draftCount: z.number() }),
  outputSchema: PropPhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    // No props in outline → immediately publish a completion (no review
    // needed, no drafts to approve) and move user toward episode phase.
    if (inputData.draftCount === 0) {
      await publishWorkflowCompleted(ctx.projectId, runId, "prop_phase", {
        committed: [],
        summaryKey: "propPhaseSummaryEmpty",
        // Nothing was generated → nothing to revise. Hiding the Revise
        // button prevents confusing "what would I revise?" clicks.
        revisable: false,
        nextSteps: [
          {
            workflowName: "episode_phase",
            labelKey: "workflowNextContinueToEpisodes",
            variant: "primary",
          },
        ],
      });
      return {
        runId,
        draftCount: 0,
        message: "No props require dedicated design in this story outline — skipped.",
      };
    }

    await reportProgress(runId, {
      stepId: "prop_phase.review",
      current: inputData.draftCount,
      total: inputData.draftCount,
      label: `Generated ${inputData.draftCount} props — awaiting confirmation before next phase`,
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
      estimatedCost: drafts.length * PRICES.propPerUnit,
    });

    return {
      runId,
      draftCount: inputData.draftCount,
      message: `Generated ${inputData.draftCount} prop drafts — awaiting review.`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const propPhaseWorkflow = createWorkflow({
  id: "prop_phase",
  description:
    "Prop phase: expand from the story skeleton's props roster → prop drafts into Redis → wait for user confirmation. After approval, apply_phase_drafts commits to Java.",
  inputSchema: PropPhaseInputSchema,
  outputSchema: PropPhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(collectDraftsStep)
  .then(emitReviewStep)
  .commit();

// ─── Apply helper ──────────────────────────────────────────────────────

export interface ApplyPropDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
  /** See role-phase.applyRoleDrafts for rationale. */
  emitLifecycleMessage?: boolean;
}

export interface ApplyPropDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

export async function applyPropDrafts(
  opts: ApplyPropDraftsOptions
): Promise<ApplyPropDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
  await throwIfCancelled(runId);

  const pending = await listDrafts<PropCreateData>(runId, {
    entityType: "prop",
    statuses: ["pending"],
  });
  const nameByRef: Record<string, string> = {};
  for (const d of pending) nameByRef[d.clientRefId] = d.data.name;
  const pendingRefIds = pending.map((d) => d.clientRefId);

  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.propPerUnit,
      reason: `prop_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "prop_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "prop_phase",
      terminalStatus: "cancelled",
      error: feedback ? `User requested changes: ${feedback}` : "User rejected.",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "prop_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `Prop phase rejected. Feedback: ${feedback}` : "Prop phase rejected.",
      completion: null,
      failure: failurePayload,
    };
  }

  const accepted = new Set(acceptedClientRefIds ?? pendingRefIds);
  const items = pending
    .filter((d) => accepted.has(d.clientRefId))
    .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

  for (const it of items) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `Saving ${items.length} props…`;
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
      entity: "prop",
      action: "batch_created",
      source: "prop_phase",
    });
  }

  const endLabel = `Props committed: ${committed.length} ok / ${failed.length} failed`;
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

  const summaryKey =
    outcome === "committed" ? "propPhaseSummaryCommitted" : "propPhaseSummaryPartial";
  const summaryParams = {
    count: committed.length,
    failed: failed.length,
    total: items.length,
  };
  const logMessage =
    outcome === "committed"
      ? `committed ${committed.length} props`
      : `partial failure: ${committed.length} ok, ${failed.length} failed`;

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "prop_phase",
    committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
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
      {
        workflowName: "episode_phase",
        labelKey: "workflowNextSkipToEpisodes",
        variant: "secondary",
      },
    ],
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "prop_phase", {
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
