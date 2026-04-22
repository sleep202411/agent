/**
 * scene_image_phase — batch-generate scene reference images for all scenes
 * in Java's worldscene table that don't yet have images.
 *
 * Mirror of role_image_phase. Dispatches one image job per scene then polls
 * the asset-image-status hash until every dispatched asset reaches terminal.
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

export const SceneImagePhaseInputSchema = z.object({
  feedback: z.string().optional(),
});

export const SceneImagePhaseOutputSchema = z.object({
  outcome: z.enum(["all_ready", "partial_failure", "no_scenes", "timeout"]),
  totalCount: z.number(),
  readyCount: z.number(),
  failedCount: z.number(),
  message: z.string(),
});

const DispatchedSchema = z.object({
  assetIds: z.array(z.string()),
});

const dispatchStep = createStep({
  id: "dispatch",
  inputSchema: SceneImagePhaseInputSchema,
  outputSchema: DispatchedSchema,
  execute: async ({ requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";

    await throwIfCancelled(runId);

    type RawScene = {
      id?: string | number;
      name?: string;
      description?: string;
      prompt?: string;
      sceneImgPath?: string[];
    };
    const listed = await javaRequest<{ list?: RawScene[] }>(
      ctx,
      "/api/user/world/list/worldscene",
      {
        data: { worldId: ctx.worldId ?? "", page: 1, pageSize: 999 },
      }
    ).catch<{ list?: RawScene[] }>(() => ({ list: [] }));

    type ResolvedScene = {
      id: string | number;
      name: string;
      description?: string;
      prompt?: string;
      sceneImgPath?: string[];
    };
    const scenes: ResolvedScene[] = (listed.list ?? []).filter(
      (s): s is ResolvedScene => s.id != null && typeof s.name === "string"
    );

    if (scenes.length === 0) {
      return { assetIds: [] };
    }

    const queue = getImageQueue();
    const dispatched: string[] = [];
    for (const scene of scenes) {
      const assetId = String(scene.id);
      const prompt = (scene.prompt ?? scene.description ?? "").trim();
      if (!prompt) continue;
      // Skip scenes that already have an imgPath (see role-image-phase
      // for rationale — avoid re-spending credits + inflating total).
      if (Array.isArray(scene.sceneImgPath) && scene.sceneImgPath.some((p) => p && p.trim())) {
        continue;
      }
      await setAssetImageStatus(ctx.projectId, "scene", assetId, { status: "pending" });
      await queue.add(
        "generate",
        {
          projectId: ctx.projectId,
          worldId: ctx.worldId ?? "",
          assetType: "scene",
          assetId,
          prompt,
          assetName: scene.name,
          ctx,
        },
        { jobId: buildImageJobId("scene", assetId) }
      );
      dispatched.push(assetId);
    }

    await reportProgress(runId, {
      stepId: "dispatch",
      current: 0,
      total: dispatched.length,
      label: `派发 ${dispatched.length} 张图任务`,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "scene_image_phase", "committing", {
      current: 0,
      total: dispatched.length,
      label: `派发 ${dispatched.length} 张图任务`,
    });

    return { assetIds: dispatched };
  },
});

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
  outputSchema: SceneImagePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";
    const { assetIds } = inputData;

    if (assetIds.length === 0) {
      await publishWorkflowCompleted(ctx.projectId, runId, "scene_image_phase", {
        committed: [],
        summary: "没有可生成参考图的场景。",
        nextSteps: [
          {
            workflowName: "prop_phase",
            labelKey: "workflowNextContinueToProps",
            variant: "primary",
          },
        ],
      });
      return {
        outcome: "no_scenes" as const,
        totalCount: 0,
        readyCount: 0,
        failedCount: 0,
        message: "没有可生成参考图的场景。",
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
        const rec = statusMap[`scene:${id}`];
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
        await publishWorkflowProgress(ctx.projectId, runId, "scene_image_phase", "committing", {
          current: readyCount,
          total: assetIds.length,
          label,
        });
      }

      if (terminal === assetIds.length) {
        const outcome = failedCount === 0 ? ("all_ready" as const) : ("partial_failure" as const);
        const message =
          failedCount === 0
            ? `全部 ${readyCount} 张场景参考图生成完成。`
            : `完成 ${readyCount} 张，失败 ${failedCount} 张（失败的场景可以在资产库单独重试）。`;
        await publishWorkflowCompleted(ctx.projectId, runId, "scene_image_phase", {
          committed: Array.from({ length: readyCount }, (_, i) => ({
            serverId: assetIds[i] ?? `scene-${i}`,
          })),
          summary: message,
          nextSteps: [
            {
              workflowName: "prop_phase",
              labelKey: "workflowNextContinueToProps",
              variant: "primary",
            },
          ],
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

    const message = `生图等待超时：完成 ${readyCount}，失败 ${failedCount}，剩余 ${assetIds.length - readyCount - failedCount} 仍在处理中。`;
    await publishWorkflowCompleted(ctx.projectId, runId, "scene_image_phase", {
      committed: Array.from({ length: readyCount }, (_, i) => ({
        serverId: assetIds[i] ?? `scene-${i}`,
      })),
      summary: message,
      nextSteps: [
        {
          workflowName: "prop_phase",
          labelKey: "workflowNextContinueToProps",
          variant: "primary",
        },
      ],
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

export const sceneImagePhaseWorkflow = createWorkflow({
  id: "scene_image_phase",
  description: "批量为已入库场景生成参考图：派发 BullMQ 任务，轮询状态直到全部终态。",
  inputSchema: SceneImagePhaseInputSchema,
  outputSchema: SceneImagePhaseOutputSchema,
})
  .then(dispatchStep)
  .then(waitAllStep)
  .commit();

export type SceneImagePhaseOutput = z.infer<typeof SceneImagePhaseOutputSchema>;
