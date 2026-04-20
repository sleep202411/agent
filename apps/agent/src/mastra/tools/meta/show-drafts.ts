import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ENTITY_TYPES, type EntityType } from "../../lib/redis-keys";
import { listDrafts } from "../../lib/drafts";

export const showDrafts = createTool({
  id: "show_drafts",
  description:
    '列出一个 workflow run 当前待确认的 drafts。当用户问"生成了什么?"或需要在确认前预览时调用。',
  inputSchema: z.object({
    runId: z.string(),
    entityType: z.enum(ENTITY_TYPES).optional(),
  }),
  outputSchema: z.object({
    runId: z.string(),
    count: z.number(),
    drafts: z.array(z.record(z.string(), z.any())),
  }),
  execute: async ({ runId, entityType }) => {
    const drafts = await listDrafts(runId, {
      entityType: entityType as EntityType | undefined,
    });
    return {
      runId,
      count: drafts.length,
      drafts: drafts.map((d) => ({
        clientRefId: d.clientRefId,
        entityType: d.entityType,
        status: d.status,
        data: d.data,
        serverId: d.serverId,
        error: d.error,
      })),
    };
  },
});
