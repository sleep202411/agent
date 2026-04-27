/**
 * role_design workflow — the Phase 2 reference workflow.
 *
 * Flow:
 *   plan_roles  (LLM via role-designer persona, structured output)
 *     ↓
 *   collect_drafts  (write each role as a Redis draft under the run)
 *     ↓
 *   wait_confirmation  (HITL — suspend until user clicks approve/reject)
 *     ↓
 *   apply_decision
 *     ├── approved → batchUpsertRoles → commit all drafts to Java → purge drafts
 *     └── rejected → mark drafts discarded, return rejection reason
 *
 * Image generation is intentionally out of scope — too slow for Phase 2.
 * Images can be added later as a separate `generate_main_image` step that
 * fires image-gen tasks and polls for completion before collect_drafts.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { batchUpsertRoles, type RoleCreateData } from "../lib/batch-writers/world-assets";
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

const PlannedRole = z.object({
  name: z.string().min(1).max(20),
  role: z.string().min(1),
  appearance: z.string().min(1),
  personality: z.string().min(1),
  prompt: z.string().default(""),
});
type PlannedRole = z.infer<typeof PlannedRole>;

const InputSchema = z.object({
  outline: z.string().min(1, "Story outline is required"),
  worldId: z.string().min(1, "worldId is required"),
  roleCount: z.number().int().min(1).max(12).default(4),
  /** Optional revision feedback carried from a previous run that was rejected. */
  feedback: z.string().optional(),
});

const OutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  plannedRoles: z.array(PlannedRole).default([]),
  draftClientRefIds: z.array(z.string()).default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  /** How many drafts are pending. Surfaced in the task card prompt. */
  draftCount: z.number(),
  /** The run this gate belongs to — lets the confirmation UI load drafts. */
  runId: z.string(),
});

// ─── Step 1: plan_roles — LLM designs the cast ────────────────────────

const planRolesStep = createStep({
  id: "plan_roles",
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
        stepId: "plan_roles",
        current: 0,
        total: inputData.roleCount,
        label: "Character designer is drafting roles…",
      });
      await publishWorkflowProgress(ctx.projectId, runId, "role_design", "planning", {
        current: 0,
        total: inputData.roleCount,
        label: "Character designer is drafting roles…",
      });
    }

    const designer = mastra?.getAgent("roleDesigner");
    if (!designer) throw new Error("roleDesigner agent not registered");

    const designerSchema = z.object({ roles: z.array(PlannedRole) });
    const { object: designed } = await robustStructuredGenerate({
      agent: designer,
      prompt: buildPlanPrompt(inputData, stylePainting),
      schema: designerSchema,
      tag: `role-designer-${runId ?? "nr"}`,
      isEmpty: (obj) => !obj?.roles || obj.roles.length === 0,
    });
    const plannedRoles = designed.roles
      .slice(0, inputData.roleCount)
      .filter((r) => r.name && r.role);

    if (plannedRoles.length === 0) {
      throw new Error("role-designer failed to produce any valid roles");
    }

    setState({
      plannedRoles,
      draftClientRefIds: state.draftClientRefIds ?? [],
    });
    if (runId) {
      const doneLabel = `Designed ${plannedRoles.length} characters`;
      await reportProgress(runId, {
        stepId: "plan_roles",
        current: plannedRoles.length,
        total: inputData.roleCount,
        label: doneLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "role_design", "planning", {
        current: plannedRoles.length,
        total: inputData.roleCount,
        label: doneLabel,
      });
    }
    return { done: true as const };
  },
});

function buildPlanPrompt(input: z.infer<typeof InputSchema>, stylePainting?: string): string {
  const feedbackBlock = input.feedback
    ? `\n\nUser feedback from the previous round (must be adopted):\n${input.feedback}\n`
    : "";
  return [
    `Design ${input.roleCount} characters based on the story outline below:`,
    "",
    input.outline,
    feedbackBlock,
    "",
    "Output language: default English. If the project context provides a `dialogLanguage` (or equivalent locale param), follow it for natural-language fields.",
    "",
    "Requirements:",
    `- Exactly ${input.roleCount} characters, no more, no fewer.`,
    "- Each character's appearance must be concrete (hairstyle / hair color / outfit / signature item) so it can drive a downstream character portrait.",
    "- Personality must help an actor (LLM) stay consistent across later dialogue scenes.",
    "- **`prompt` is the image-generation prompt** (60-120 chars / ~25-50 English words), formatted per the Role Designer persona. Must include: age range, ethnicity / racial features, hair, eyes / expression, 2+ specific garments (color + material), at least one signature item / scar / accessory, and framing.",
    "- Return a JSON object whose `roles` field is the array of characters; each entry has `name` / `role` / `appearance` / `personality` / `prompt`.",
    stylePaintingHint(stylePainting),
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Step 2: collect_drafts — write each planned role as a Draft ──────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: z.object({ done: z.literal(true) }),
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ state, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    const worldId = requestContext?.get("worldId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    if (!worldId) {
      throw new Error(
        "worldId missing from requestContext — cannot build draft payloads without it"
      );
    }
    await throwIfCancelled(runId);

    const plannedRoles = state.plannedRoles ?? [];
    const draftClientRefIds: string[] = [];
    let i = 0;
    for (const role of plannedRoles) {
      const clientRefId = randomUUID();
      const imagePrompt =
        role.prompt && role.prompt.trim().length > 0 ? role.prompt.trim() : role.appearance;
      const data: RoleCreateData = {
        worldId,
        name: role.name,
        description: [
          `Role: ${role.role}`,
          `Appearance: ${role.appearance}`,
          `Personality: ${role.personality}`,
        ].join("\n"),
        prompt: imagePrompt,
        roleImgPath: [],
        referenceImgPath: [],
        referenceImgDescription: [],
        model: "",
        voiceId: "",
      };
      await putDraft(runId, "role", clientRefId, data);
      draftClientRefIds.push(clientRefId);
      i += 1;
      await reportProgress(runId, {
        stepId: "collect_drafts",
        current: i,
        total: plannedRoles.length,
        label: `Collected ${i}/${plannedRoles.length} character drafts`,
      });
    }

    setState({ plannedRoles, draftClientRefIds });
    return { draftCount: draftClientRefIds.length };
  },
});

// ─── Step 3: wait_confirmation — HITL gate ────────────────────────────

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
    if (!runId) throw new Error("runId missing from requestContext");
    const ctx = getContext(requestContext);

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "wait_confirmation",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} character drafts generated — awaiting confirmation`,
      });
      const drafts = await listDrafts<RoleCreateData>(runId, {
        entityType: "role",
        statuses: ["pending"],
      });
      await publishWorkflowSuspended(ctx.projectId, runId, "role_design", {
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
      });
      return await suspend({
        runId,
        draftCount: inputData.draftCount,
      });
    }

    return {
      approved: resumeData.approved,
      feedback: resumeData.feedback,
      acceptedClientRefIds: resumeData.acceptedClientRefIds,
    };
  },
});

// ─── Step 4: apply_decision — commit or mark rejected ─────────────────

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
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);

    const draftClientRefIds = state.draftClientRefIds ?? [];

    if (!inputData.approved) {
      // User rejected — mark drafts as discarded and return with feedback.
      for (const clientRefId of draftClientRefIds) {
        await markDraftDiscarded(runId, clientRefId);
      }
      await reportProgress(runId, {
        stepId: "apply_decision",
        current: 0,
        total: draftClientRefIds.length,
        label: "User chose to rework — task ended; invoke role_design again with feedback",
      });
      await publishWorkflowFailed(ctx.projectId, runId, "role_design", {
        terminalStatus: "cancelled",
        error: inputData.feedback
          ? `User requested changes: ${inputData.feedback}`
          : "User rejected.",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `User rejected. Feedback: ${inputData.feedback}`
          : "User rejected.",
      };
    }

    // User approved — commit to Java via BatchWriter.
    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<RoleCreateData>(runId, {
      entityType: "role",
      statuses: ["pending"],
    });
    const items = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .map((d) => ({ clientRefId: d.clientRefId, data: d.data }));

    // Flip draft status to 'committing' so clients see the intent.
    for (const item of items) {
      await markDraftCommitting(runId, item.clientRefId);
    }

    const commitStartLabel = `Saving ${items.length} characters to project…`;
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 0,
      total: items.length,
      label: commitStartLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "role_design", "committing", {
      current: 0,
      total: items.length,
      label: commitStartLabel,
    });

    const results = await batchUpsertRoles(ctx, items, { concurrency: 1 });

    const committed: { clientRefId: string; serverId: string }[] = [];
    const failed: { clientRefId: string; reason: string }[] = [];
    for (const r of results) {
      if (r.status === "created" || r.status === "unchanged") {
        await markDraftCommitted(runId, r.clientRefId, r.serverId!);
        committed.push({ clientRefId: r.clientRefId, serverId: r.serverId! });
      } else {
        await markDraftFailed(runId, r.clientRefId, r.error ?? "unknown error");
        failed.push({ clientRefId: r.clientRefId, reason: r.error ?? "unknown error" });
      }
    }

    const summary = summarizeBatch(results);
    const outcome: z.infer<typeof OutputSchema>["outcome"] =
      summary.failed === 0 ? "committed" : "partial_failure";

    // Purge drafts on full success; keep them on partial failure for retry.
    if (outcome === "committed") {
      await deleteAllDrafts(runId);
    }

    const endLabel = `Commit done — ${committed.length} ok, ${failed.length} failed`;
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: committed.length,
      total: items.length,
      label: endLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "role_design", "committing", {
      current: committed.length,
      total: items.length,
      label: endLabel,
    });

    const summaryKey =
      outcome === "committed" ? "roleDesignSummaryCommitted" : "roleDesignSummaryPartial";
    const summaryParams = {
      count: committed.length,
      failed: failed.length,
      total: items.length,
    };
    const logMessage =
      outcome === "committed"
        ? `committed ${committed.length} roles`
        : `partial: ${committed.length} ok, ${failed.length} failed, drafts kept for retry`;

    await publishWorkflowCompleted(ctx.projectId, runId, "role_design", {
      committed: committed.map((c) => ({ serverId: c.serverId })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summaryKey,
      summaryParams,
      nextSteps: [
        {
          workflowName: "role_image_phase",
          labelKey: "workflowNextContinueToRoleImages",
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

export const roleDesignWorkflow = createWorkflow({
  id: "role_design",
  description:
    "Design characters from a story outline, commit to the database after human review — does not generate character portraits.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
})
  .then(planRolesStep)
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();
