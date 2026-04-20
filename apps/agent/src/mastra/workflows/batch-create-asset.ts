/**
 * batch_create_asset workflow — user-provided bulk creation of roles / scenes
 * / props with a HITL confirmation gate before committing to Java.
 *
 * Called when the router agent interprets the user intent as "please add
 * these specific items" (not "help me design some"). No LLM in the loop —
 * items come from the agent's tool input verbatim.
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  batchUpsertProps,
  batchUpsertRoles,
  batchUpsertScenes,
} from "../lib/batch-writers/world-assets";
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
import type { EntityType } from "../lib/redis-keys";

// ─── Schemas ───────────────────────────────────────────────────────────

const AssetType = z.enum(["role", "scene", "prop"]);
type AssetType = z.infer<typeof AssetType>;

const ItemSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
  prompt: z.string().optional(),
});
type Item = z.infer<typeof ItemSchema>;

const InputSchema = z.object({
  assetType: AssetType,
  worldId: z.string().min(1),
  items: z.array(ItemSchema).min(1).max(50),
});

const OutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  assetType: AssetType,
  committed: z.array(z.object({ clientRefId: z.string(), serverId: z.string() })),
  failed: z.array(z.object({ clientRefId: z.string(), reason: z.string() })),
  message: z.string(),
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
  draftCount: z.number(),
  assetType: AssetType,
});

// ─── Step 1: collect_drafts ────────────────────────────────────────────

const collectDraftsStep = createStep({
  id: "collect_drafts",
  inputSchema: InputSchema,
  outputSchema: z.object({ draftCount: z.number(), assetType: AssetType }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const entityType: EntityType = inputData.assetType;
    const draftClientRefIds: string[] = [];
    let i = 0;
    for (const item of inputData.items) {
      const clientRefId = randomUUID();
      const data: Record<string, unknown> = {
        worldId: inputData.worldId,
        name: item.name,
        description: item.description ?? "",
      };
      if (inputData.assetType === "role") {
        Object.assign(data, {
          prompt: item.prompt ?? item.description ?? "",
          roleImgPath: [],
          referenceImgPath: [],
          referenceImgDescription: [],
          model: "",
          voiceId: "",
        });
      } else if (inputData.assetType === "scene") {
        Object.assign(data, { prompt: item.prompt ?? item.description ?? "" });
      }
      await putDraft(runId, entityType, clientRefId, data);
      draftClientRefIds.push(clientRefId);
      i += 1;
      await reportProgress(runId, {
        stepId: "collect_drafts",
        current: i,
        total: inputData.items.length,
        label: `已收集 ${i}/${inputData.items.length} 个 ${inputData.assetType} 草稿`,
      });
    }

    setState({ draftClientRefIds });
    return { draftCount: draftClientRefIds.length, assetType: inputData.assetType };
  },
});

// ─── Step 2: wait_confirmation ─────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ draftCount: z.number(), assetType: AssetType }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
    assetType: AssetType,
  }),
  stateSchema: StateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "wait_confirmation",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} 个 ${inputData.assetType} 草稿已生成，等待确认`,
      });
      return await suspend({
        runId,
        draftCount: inputData.draftCount,
        assetType: inputData.assetType,
      });
    }

    return {
      approved: resumeData.approved,
      feedback: resumeData.feedback,
      acceptedClientRefIds: resumeData.acceptedClientRefIds,
      assetType: inputData.assetType,
    };
  },
});

// ─── Step 3: apply_decision ────────────────────────────────────────────

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
    assetType: AssetType,
  }),
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const draftClientRefIds = state.draftClientRefIds ?? [];
    const entityType: EntityType = inputData.assetType;

    if (!inputData.approved) {
      for (const clientRefId of draftClientRefIds) {
        await markDraftDiscarded(runId, clientRefId);
      }
      await reportProgress(runId, {
        stepId: "apply_decision",
        current: 0,
        total: draftClientRefIds.length,
        label: "用户取消入库",
      });
      return {
        outcome: "rejected" as const,
        assetType: inputData.assetType,
        committed: [],
        failed: [],
        message: inputData.feedback ? `用户未通过。反馈：${inputData.feedback}` : "用户未通过。",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts(runId, { entityType, statuses: ["pending"] });
    const items = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .map((d) => ({
        clientRefId: d.clientRefId,
        data: d.data as never,
      }));

    for (const item of items) {
      await markDraftCommitting(runId, item.clientRefId);
    }

    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 0,
      total: items.length,
      label: `入库 ${items.length} 个 ${inputData.assetType}…`,
    });

    const results =
      entityType === "role"
        ? await batchUpsertRoles(ctx, items as never, { concurrency: 1 })
        : entityType === "scene"
          ? await batchUpsertScenes(ctx, items as never, { concurrency: 1 })
          : await batchUpsertProps(ctx, items as never, { concurrency: 1 });

    const committed: { clientRefId: string; serverId: string }[] = [];
    const failed: { clientRefId: string; reason: string }[] = [];
    for (const r of results) {
      if (r.status === "created" || r.status === "unchanged") {
        await markDraftCommitted(runId, r.clientRefId, r.serverId!);
        committed.push({ clientRefId: r.clientRefId, serverId: r.serverId! });
      } else {
        await markDraftFailed(runId, r.clientRefId, r.error ?? "unknown");
        failed.push({ clientRefId: r.clientRefId, reason: r.error ?? "unknown" });
      }
    }

    const summary = summarizeBatch(results);
    const outcome: z.infer<typeof OutputSchema>["outcome"] =
      summary.failed === 0 ? "committed" : "partial_failure";

    if (outcome === "committed") {
      await deleteAllDrafts(runId);
    }

    await reportProgress(runId, {
      stepId: "apply_decision",
      current: committed.length,
      total: items.length,
      label: `入库完成 — 成功 ${committed.length}，失败 ${failed.length}`,
    });

    return {
      outcome,
      assetType: inputData.assetType,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已成功入库 ${committed.length} 个 ${inputData.assetType}。`
          : `成功 ${committed.length}，失败 ${failed.length}。失败项保留在草稿区供重试。`,
    };
  },
});

// ─── Compose ───────────────────────────────────────────────────────────

export const batchCreateAssetWorkflow = createWorkflow({
  id: "batch_create_asset",
  description: "用户直接给出角色/场景/道具列表，草稿 → 确认 → 入库，不经 LLM。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
})
  .then(collectDraftsStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();
