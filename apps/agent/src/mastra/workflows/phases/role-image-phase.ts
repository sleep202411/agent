/**
 * role_image_phase — batch-generate character main images for all roles
 * that exist in the project but don't yet have images.
 *
 * Split out from `role_phase` so the user confirms the text drafts first
 * (fast turn) and only commits to image generation (slow — dashscope can
 * throttle) once the cast text is stable.
 *
 * Flow:
 *   [1] dispatch  → list committed roles from Java, enqueue one image job
 *                   per role (skip ones that already have imgPath), seed
 *                   status hash to "pending".
 *   [2] wait_all  → poll the project asset-image-status hash until every
 *                   dispatched asset reaches a terminal state (ready or
 *                   failed_*). Soft timeout at 5 min; past that we still
 *                   return what succeeded and report the rest as failures.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { reportProgress, throwIfCancelled } from "../engine";
import { getImageQueue, buildImageJobId } from "../engine/image-queue";
import { getProjectAssetImageStatus, setAssetImageStatus } from "../../lib/asset-image-status";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishWorkflowCompleted, publishWorkflowProgress } from "../../lib/workflow-messages";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

// ─── Schemas ───────────────────────────────────────────────────────────

export const RoleImagePhaseInputSchema = z.object({
  /** Accept but ignore — schema kept for parity with other phases. */
  feedback: z.string().optional(),
});

export const RoleImagePhaseOutputSchema = z.object({
  outcome: z.enum(["all_ready", "partial_failure", "no_roles", "timeout"]),
  totalCount: z.number(),
  readyCount: z.number(),
  failedCount: z.number(),
  message: z.string(),
});

const DispatchedSchema = z.object({
  assetIds: z.array(z.string()),
});

// ─── Step 1: dispatch ──────────────────────────────────────────────────

const dispatchStep = createStep({
  id: "dispatch",
  inputSchema: RoleImagePhaseInputSchema,
  outputSchema: DispatchedSchema,
  execute: async ({ requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";

    await throwIfCancelled(runId);

    type RawRole = {
      id?: string | number;
      name?: string;
      description?: string;
      prompt?: string;
      roleImgPath?: string[];
    };
    const listed = await javaRequest<{ list?: RawRole[] }>(ctx, "/api/user/world/list/worldrole", {
      data: { worldId: ctx.worldId ?? "", page: 1, pageSize: 999 },
    }).catch<{ list?: RawRole[] }>(() => ({ list: [] }));

    type ResolvedRole = {
      id: string | number;
      name: string;
      description?: string;
      prompt?: string;
      roleImgPath?: string[];
    };
    const roles: ResolvedRole[] = (listed.list ?? []).filter(
      (r): r is ResolvedRole => r.id != null && typeof r.name === "string"
    );

    if (roles.length === 0) {
      return { assetIds: [] };
    }

    const queue = getImageQueue();
    const dispatched: string[] = [];
    for (const role of roles) {
      const assetId = String(role.id);
      const prompt = (role.prompt ?? role.description ?? "").trim();
      if (!prompt) continue;
      // Skip roles that already have an imgPath — regenerating would just
      // overwrite an existing image, cost Java credits, and inflate the
      // progress card's "total" with items the user doesn't actually care
      // about on THIS run.
      if (Array.isArray(role.roleImgPath) && role.roleImgPath.some((p) => p && p.trim())) {
        continue;
      }
      await setAssetImageStatus(ctx.projectId, "role", assetId, { status: "pending" });
      await queue.add(
        "generate",
        {
          projectId: ctx.projectId,
          worldId: ctx.worldId ?? "",
          assetType: "role",
          assetId,
          prompt,
          assetName: role.name,
          ctx,
        },
        { jobId: buildImageJobId("role", assetId) }
      );
      dispatched.push(assetId);
    }

    await reportProgress(runId, {
      stepId: "dispatch",
      current: 0,
      total: dispatched.length,
      label: `派发 ${dispatched.length} 张图任务`,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "role_image_phase", "committing", {
      current: 0,
      total: dispatched.length,
      label: `派发 ${dispatched.length} 张图任务`,
    });

    return { assetIds: dispatched };
  },
});

// ─── Step 2: wait_all ──────────────────────────────────────────────────

function isTerminal(status: string): boolean {
  return (
    status === "ready" ||
    status === "failed_config" ||
    status === "failed_policy" ||
    status === "failed_server" ||
    status === "failed_upload"
  );
}

const waitAllStep = createStep({
  id: "wait_all",
  inputSchema: DispatchedSchema,
  outputSchema: RoleImagePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";
    const { assetIds } = inputData;

    if (assetIds.length === 0) {
      await publishWorkflowCompleted(ctx.projectId, runId, "role_image_phase", {
        committed: [],
        summary: "没有可生成主图的角色。",
        nextStep: {
          workflowName: "scene_phase",
          labelKey: "workflowNextContinueToScenes",
        },
      });
      return {
        outcome: "no_roles" as const,
        totalCount: 0,
        readyCount: 0,
        failedCount: 0,
        message: "没有可生成主图的角色。",
      };
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let readyCount = 0;
    let failedCount = 0;
    let lastReportedReady = -1;

    while (Date.now() < deadline) {
      await throwIfCancelled(runId);
      const statusMap = await getProjectAssetImageStatus(ctx.projectId);
      readyCount = 0;
      failedCount = 0;
      let terminal = 0;
      for (const id of assetIds) {
        const rec = statusMap[`role:${id}`];
        if (!rec) continue;
        if (rec.status === "ready") {
          readyCount += 1;
          terminal += 1;
        } else if (isTerminal(rec.status)) {
          failedCount += 1;
          terminal += 1;
        }
      }

      if (readyCount !== lastReportedReady) {
        lastReportedReady = readyCount;
        const label = failedCount > 0 ? `已就绪（${failedCount} 失败）` : `已就绪`;
        await reportProgress(runId, {
          stepId: "wait_all",
          current: readyCount,
          total: assetIds.length,
          label,
        });
        await publishWorkflowProgress(ctx.projectId, runId, "role_image_phase", "committing", {
          current: readyCount,
          total: assetIds.length,
          label,
        });
      }

      if (terminal === assetIds.length) {
        const outcome = failedCount === 0 ? ("all_ready" as const) : ("partial_failure" as const);
        const message =
          failedCount === 0
            ? `全部 ${readyCount} 张角色主图生成完成。`
            : `完成 ${readyCount} 张，失败 ${failedCount} 张（失败的角色可以在资产库单独重试）。`;
        await publishWorkflowCompleted(ctx.projectId, runId, "role_image_phase", {
          committed: Array.from({ length: readyCount }, (_, i) => ({
            serverId: assetIds[i] ?? `role-${i}`,
          })),
          summary: message,
          nextStep: {
            workflowName: "scene_phase",
            labelKey: "workflowNextContinueToScenes",
          },
        });
        return {
          outcome,
          totalCount: assetIds.length,
          readyCount,
          failedCount,
          message,
        };
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Timeout — return whatever state we have.
    const message = `生图等待超时：完成 ${readyCount}，失败 ${failedCount}，剩余 ${assetIds.length - readyCount - failedCount} 仍在处理中。`;
    await publishWorkflowCompleted(ctx.projectId, runId, "role_image_phase", {
      committed: Array.from({ length: readyCount }, (_, i) => ({
        serverId: assetIds[i] ?? `role-${i}`,
      })),
      summary: message,
      nextStep: {
        workflowName: "scene_phase",
        labelKey: "workflowNextContinueToScenes",
      },
    });
    return {
      outcome: "timeout" as const,
      totalCount: assetIds.length,
      readyCount,
      failedCount,
      message,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const roleImagePhaseWorkflow = createWorkflow({
  id: "role_image_phase",
  description: "批量为已入库角色生成主图：派发 BullMQ 任务，轮询状态直到全部终态。",
  inputSchema: RoleImagePhaseInputSchema,
  outputSchema: RoleImagePhaseOutputSchema,
})
  .then(dispatchStep)
  .then(waitAllStep)
  .commit();

export type RoleImagePhaseOutput = z.infer<typeof RoleImagePhaseOutputSchema>;
