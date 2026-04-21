/**
 * update_project — rename the current project / change its description /
 * update the cover image path. Direct Java write, no HITL.
 *
 * Java's `/api/user/world/update/worldproduct` is a full-replacement endpoint,
 * so we fetch current detail first and merge the patch on top.
 *
 * Intentionally **does NOT** let the LLM change the four "core params"
 * (aspectRatioType / chapterLength / stylePainting / dialogLanguage) —
 * those go through `require_project_params` so the user sees the form +
 * `<PROJECT_PARAMS_CONFIRMED>` marker. Allowing LLM to silently patch them
 * here would create a second path and desync the UI.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

export const updateProject = createTool({
  id: "update_project",
  description:
    '更新当前项目的名称 / 描述 / 封面路径。用户明确说"改项目名为 xxx"、"改项目描述"、"换封面"时调。**不要**用这个工具改画幅/集时长/画风/对白语言 —— 那些走 require_project_params。',
  inputSchema: z.object({
    name: z.string().optional().describe("项目名"),
    description: z.string().optional().describe("项目一句话描述"),
    imagePath: z.string().optional().describe("封面 OSS 路径（完整 URL 或相对路径）"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ name, description, imagePath }, execCtx) => {
    if (!name && !description && !imagePath) {
      return { ok: false, message: "至少提供一个字段：name / description / imagePath" };
    }
    const ctx = getContext(execCtx?.requestContext);
    const current = await javaRequest<Record<string, unknown>>(
      ctx,
      `/api/user/project/detail/${ctx.projectId}`
    );
    // Java requires full object on update — preserve everything else.
    await javaRequest(ctx, "/api/user/world/update/worldproduct", {
      data: {
        ...current,
        id: ctx.projectId,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(imagePath ? { imagePath } : {}),
      },
    });
    const parts: string[] = [];
    if (name) parts.push(`名称改为「${name}」`);
    if (description) parts.push("描述已更新");
    if (imagePath) parts.push("封面已更新");
    return { ok: true, message: `项目${parts.join("、")}` };
  },
});
