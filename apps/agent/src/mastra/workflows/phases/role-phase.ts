/**
 * role_phase — commits a pre-computed list of characters to Java, with HITL.
 *
 * Distinct from role_design (which *invents* characters from an outline).
 * This phase takes characters produced upstream (e.g. by script_breakdown)
 * and does draft → HITL → batch commit. Reused as a step in main_flow.
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
import { getContext } from "../../lib/workspace-client";
import { summarizeBatch } from "../../lib/batch-writer";

// ─── Schemas ───────────────────────────────────────────────────────────

const CharacterSchema = z.object({
  name: z.string().min(1).max(20),
  role: z.string().min(1),
  appearance: z.string().min(1),
  personality: z.string().min(1),
});

export const RolePhaseInputSchema = z.object({
  worldId: z.string().min(1),
  characters: z.array(CharacterSchema).min(1),
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

// ─── Step 1: collect drafts ───────────────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: RolePhaseInputSchema,
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
        prompt: c.appearance,
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

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "role_phase.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `已生成 ${inputData.draftCount} 个角色，等待确认后进入下一阶段`,
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

    await reportProgress(runId, {
      stepId: "role_phase.commit",
      current: 0,
      total: items.length,
      label: `入库 ${items.length} 个角色…`,
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

    await reportProgress(runId, {
      stepId: "role_phase.commit",
      current: committed.length,
      total: items.length,
      label: `角色入库完成：成功 ${committed.length} / 失败 ${failed.length}`,
    });

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已入库 ${committed.length} 个角色，进入下一阶段。`
          : `入库有失败：成功 ${committed.length}，失败 ${failed.length}。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const rolePhaseWorkflow = createWorkflow({
  id: "role_phase",
  description: "接收外部提供的角色清单，草稿→HITL→入库。用作主流程的角色阶段。",
  inputSchema: RolePhaseInputSchema,
  outputSchema: RolePhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type RolePhaseOutput = z.infer<typeof RolePhaseOutputSchema>;
