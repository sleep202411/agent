/**
 * list_assets — paged full listing of roles / scenes / props in the current
 * world. Complements `query_context` (which only returns the first 8 names
 * as a sample) for cases where the user asks for a complete enumeration
 * ("列出所有角色" / "这个项目有哪些场景").
 *
 * Returns minimal fields (id / name / description) — image paths are omitted
 * to keep the payload small; ask_* personas or a dedicated detail tool can
 * pull richer data if needed.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

const KIND_TO_ROUTE = {
  role: "/api/user/world/list/worldrole",
  scene: "/api/user/world/list/worldscene",
  prop: "/api/user/world/list/worldprop",
} as const;

export const listAssets = createTool({
  id: "list_assets",
  description:
    '分页列出当前世界里的角色 / 场景 / 道具（完整列表，不是抽样）。用户问"列出全部角色 / 我有哪些场景 / 项目里所有道具是什么"时调。常规概况用 query_context 更便宜。',
  inputSchema: z.object({
    kind: z.enum(["role", "scene", "prop"]),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(50),
    query: z.string().optional().describe("按名称模糊匹配"),
  }),
  outputSchema: z.object({
    kind: z.enum(["role", "scene", "prop"]),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
      })
    ),
  }),
  execute: async ({ kind, page, pageSize, query }, execCtx) => {
    const pageNum = page ?? 1;
    const sizeNum = pageSize ?? 50;
    const ctx = getContext(execCtx?.requestContext);
    const worldId = ctx.worldId;
    if (!worldId) {
      return { kind, total: 0, page: pageNum, pageSize: sizeNum, items: [] };
    }
    const resp = await javaRequest<{
      list?: Array<Record<string, unknown>>;
      total?: number;
      totalCount?: number;
    }>(ctx, KIND_TO_ROUTE[kind], {
      data: {
        worldId,
        page: pageNum,
        pageSize: sizeNum,
        ...(query ? { name: query } : {}),
      },
    });
    const items = (resp.list ?? []).map((it) => ({
      id: String(it.id ?? ""),
      name: typeof it.name === "string" ? it.name : "",
      description:
        typeof it.description === "string"
          ? it.description
          : typeof it.prompt === "string"
            ? it.prompt
            : "",
    }));
    return {
      kind,
      total: Number(resp.totalCount ?? resp.total ?? items.length),
      page: pageNum,
      pageSize: sizeNum,
      items,
    };
  },
});
