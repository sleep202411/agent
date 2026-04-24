/**
 * prop_image_phase — batch-generate prop reference images for all props in
 * Java's worldprop table that don't yet have images.
 *
 * Mirror of role_image_phase / scene_image_phase.
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

export const PropImagePhaseInputSchema = z.object({
  feedback: z.string().optional(),
  /** See role-image-phase.onlyAssetIds — scopes run to a specific batch. */
  onlyAssetIds: z.array(z.string()).optional(),
});

export const PropImagePhaseOutputSchema = z.object({
  outcome: z.enum(["all_ready", "partial_failure", "no_props", "timeout"]),
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
  inputSchema: PropImagePhaseInputSchema,
  outputSchema: DispatchedSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";

    await throwIfCancelled(runId);

    type RawProp = {
      id?: string | number;
      name?: string;
      description?: string;
      prompt?: string;
      propImgPath?: string[];
    };
    const listed = await javaRequest<{ list?: RawProp[] }>(ctx, "/api/user/world/list/worldprop", {
      data: { worldId: ctx.worldId ?? "", page: 1, pageSize: 999 },
    }).catch<{ list?: RawProp[] }>(() => ({ list: [] }));

    type ResolvedProp = {
      id: string | number;
      name: string;
      description?: string;
      prompt?: string;
      propImgPath?: string[];
    };
    const allProps: ResolvedProp[] = (listed.list ?? []).filter(
      (p): p is ResolvedProp => p.id != null && typeof p.name === "string"
    );

    const requestedIds = new Set(inputData.onlyAssetIds ?? []);
    const props =
      requestedIds.size > 0 ? allProps.filter((p) => requestedIds.has(String(p.id))) : allProps;

    if (props.length === 0) {
      return { assetIds: [] };
    }

    const queue = getImageQueue();
    const dispatched: string[] = [];
    for (const prop of props) {
      const assetId = String(prop.id);
      const prompt = (prop.prompt ?? prop.description ?? "").trim();
      if (!prompt) continue;
      // Skip props that already have an imgPath (see role-image-phase
      // for rationale — avoid re-spending credits + inflating total).
      if (Array.isArray(prop.propImgPath) && prop.propImgPath.some((p) => p && p.trim())) {
        continue;
      }
      await setAssetImageStatus(ctx.projectId, "prop", assetId, { status: "pending" });
      await queue.add(
        "generate",
        {
          projectId: ctx.projectId,
          worldId: ctx.worldId ?? "",
          assetType: "prop",
          assetId,
          prompt,
          assetName: prop.name,
          ctx,
        },
        { jobId: buildImageJobId("prop", assetId) }
      );
      dispatched.push(assetId);
    }

    await reportProgress(runId, {
      stepId: "dispatch",
      current: 0,
      total: dispatched.length,
      label: `Dispatched ${dispatched.length} image jobs`,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "prop_image_phase", "committing", {
      current: 0,
      total: dispatched.length,
      label: `Dispatched ${dispatched.length} image jobs`,
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
  outputSchema: PropImagePhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";
    const { assetIds } = inputData;

    if (assetIds.length === 0) {
      await publishWorkflowCompleted(ctx.projectId, runId, "prop_image_phase", {
        committed: [],
        summaryKey: "propImagePhaseSummaryEmpty",
        nextSteps: [
          {
            workflowName: "episode_phase",
            labelKey: "workflowNextContinueToEpisodes",
            variant: "primary",
          },
        ],
      });
      return {
        outcome: "no_props" as const,
        totalCount: 0,
        readyCount: 0,
        failedCount: 0,
        message: "No props eligible for reference image generation.",
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
        const rec = statusMap[`prop:${id}`];
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
        await publishWorkflowProgress(ctx.projectId, runId, "prop_image_phase", "committing", {
          current: readyCount,
          total: assetIds.length,
          label,
        });
      }

      if (terminal === assetIds.length) {
        const outcome = failedCount === 0 ? ("all_ready" as const) : ("partial_failure" as const);
        const message =
          failedCount === 0
            ? `全部 ${readyCount} 张道具参考图生成完成。`
            : `完成 ${readyCount} 张，失败 ${failedCount} 张（失败的道具可以在资产库单独重试）。`;
        await publishWorkflowCompleted(ctx.projectId, runId, "prop_image_phase", {
          committed: Array.from({ length: readyCount }, (_, i) => ({
            serverId: assetIds[i] ?? `prop-${i}`,
          })),
          summary: message,
          nextSteps: [
            {
              workflowName: "episode_phase",
              labelKey: "workflowNextContinueToEpisodes",
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
    await publishWorkflowCompleted(ctx.projectId, runId, "prop_image_phase", {
      committed: Array.from({ length: readyCount }, (_, i) => ({
        serverId: assetIds[i] ?? `prop-${i}`,
      })),
      summary: message,
      nextSteps: [
        {
          workflowName: "episode_phase",
          labelKey: "workflowNextContinueToEpisodes",
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

export const propImagePhaseWorkflow = createWorkflow({
  id: "prop_image_phase",
  description: "批量为已入库道具生成参考图：派发 BullMQ 任务，轮询状态直到全部终态。",
  inputSchema: PropImagePhaseInputSchema,
  outputSchema: PropImagePhaseOutputSchema,
})
  .then(dispatchStep)
  .then(waitAllStep)
  .commit();

export type PropImagePhaseOutput = z.infer<typeof PropImagePhaseOutputSchema>;
