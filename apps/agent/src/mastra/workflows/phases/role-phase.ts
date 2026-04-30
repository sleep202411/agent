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
import { type StoryOutline } from "../../lib/outline";
import { ensureOutline } from "../../lib/outline-deps";
import { stylePaintingHint } from "../../lib/style-painting";
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
        .map((ch) => `- ${ch.chapterId} "${ch.title}": ${ch.summary}`)
        .join("\n")
    : "";
  const feedbackBlock = feedback ? `\n\n[User feedback (must be followed)]\n${feedback}\n` : "";
  return [
    "Based on the story skeleton and the cast roster entry below, produce **one complete character design** as JSON.",
    "",
    "## Story snapshot",
    `Genre: ${skeleton.genre} / Tone: ${skeleton.tone}`,
    `Main thread: ${skeleton.threads.main}`,
    `Summary: ${skeleton.storySummary}`,
    "",
    "## This character's roster entry",
    `- Name: ${entry.name}`,
    `- Function: ${entry.role}`,
    `- Arc: ${entry.arc}`,
    entry.firstAppearance ? `- First appearance: ${entry.firstAppearance}` : "",
    chapterRefs ? `\nRelevant chapters:\n${chapterRefs}` : "",
    feedbackBlock,
    "",
    "Output language: default English. If the project context provides a `dialogLanguage` (or equivalent locale param), follow it.",
    "",
    "## Fields to produce (all strings)",
    "- name: keep the roster name verbatim, do not change it",
    "- role: keep the roster function verbatim, do not change it",
    "- appearance: 15-40 characters / ~10-25 English words, **human-readable** look. Hairstyle, clothing, build, signature visual markers, comma-separated.",
    "- personality: 20-50 characters / ~15-30 English words covering personality + speech style + typical behavior, tied to the arc's growth trajectory.",
    "- prompt: **image-generation prompt**. Distinct from `appearance` — this is fed directly to the image model. **60-120 characters / ~40-80 English words**, comma-separated visual keywords in this order: subject (age + gender + ethnicity), build, hair (style + color), eyes/expression, clothing (**color + material**, at least 2 items), markers/scars/accessories (at least 1), demeanor, framing (bust / half-body / close-up). **Do not** write story background / plot / emotion — only what's visible in the frame. **Do not** add style/quality tokens (realistic, cinematic, HD, 8K, 4k, cartoon, etc.) — the project's `stylePainting` is appended downstream. Stay consistent with `appearance` but expand the detail enough that the image model produces a stable look.",
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
    const record = await ensureOutline(ctx.projectId, { requiredBy: "role_phase" });
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
      const label = `Character Designer is elaborating "${entry.name}"…`;
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
    const doneLabel = `Character design done: ${cast.length}`;
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
        description: [
          `Role: ${c.role}`,
          `Appearance: ${c.appearance}`,
          `Personality: ${c.personality}`,
        ].join("\n"),
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
        label: `Collected ${i}/${inputData.characters.length} character drafts`,
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
      label: `Generated ${inputData.draftCount} characters — awaiting confirmation before next phase`,
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
      message: `Generated ${inputData.draftCount} role drafts — awaiting review.`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const rolePhaseWorkflow = createWorkflow({
  id: "role_phase",
  description:
    "Role phase: expand from the story skeleton → role drafts into Redis → wait for user confirmation. After approval, apply_phase_drafts commits to Java; no Mastra resume.",
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
  /**
   * When true (default), publishes workflow_completed/workflow_failed as
   * side-channel chat messages — used by the direct-button path
   * (`/workflow/:runId/confirm`), which has no supervisor message to attach
   * to. Set false from the `apply_phase_drafts` Mastra tool so the card
   * rides back as tool output and becomes a part of the supervisor's own
   * message (no dangling sibling bubble).
   */
  emitLifecycleMessage?: boolean;
}

export interface ApplyRoleDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

export async function applyRoleDrafts(
  opts: ApplyRoleDraftsOptions
): Promise<ApplyRoleDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
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
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "role_phase",
      terminalStatus: "cancelled",
      error: feedback ? `User requested changes: ${feedback}` : "User rejected.",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "role_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback ? `Role phase rejected. Feedback: ${feedback}` : "Role phase rejected.",
      completion: null,
      failure: failurePayload,
    };
  }

  const accepted = new Set(acceptedClientRefIds ?? pendingRefIds);
  const items = pending
    .filter((d) => accepted.has(d.clientRefId))
    .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

  for (const it of items) await markDraftCommitting(runId, it.clientRefId);

  const startLabel = `Saving ${items.length} characters…`;
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

  if (committed.length > 0) {
    await publishEntityEvent(ctx, {
      entity: "character",
      action: "batch_created",
      source: "role_phase",
    });
  }

  const endLabel = `Characters committed: ${committed.length} ok / ${failed.length} failed`;
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

  const summaryKey =
    outcome === "committed" ? "rolePhaseSummaryCommitted" : "rolePhaseSummaryPartial";
  const summaryParams = {
    count: committed.length,
    failed: failed.length,
    total: items.length,
  };
  const logMessage =
    outcome === "committed"
      ? `committed ${committed.length} roles`
      : `partial failure: ${committed.length} ok, ${failed.length} failed`;

  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "role_phase",
    committed: committed.map((c) => ({ serverId: c.serverId, title: c.name })),
    failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
    summaryKey,
    summaryParams,
    nextSteps: [
      {
        workflowName: "role_image_phase",
        labelKey: "workflowNextContinueToRoleImages",
        variant: "primary",
        // Scope image generation to the roles we just committed, not
        // every role historically missing an imgPath.
        inputData: { onlyAssetIds: committed.map((c) => c.serverId) },
      },
      {
        workflowName: "scene_phase",
        labelKey: "workflowNextSkipToScenes",
        variant: "secondary",
      },
    ],
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "role_phase", {
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
