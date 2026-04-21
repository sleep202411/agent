/**
 * export_scripts — collect every episode's script from Java and hand the
 * merged bundle to the frontend so it can offer a .docx download.
 *
 * The frontend already has a docx-building pass in `script-view.tsx`
 * (`handleExportAll`), so this tool stays server-side only for the data
 * gather — no binary generation in the agent. Keeps the tool output small
 * (just text content) and avoids bundling docx / file-saver in the agent.
 *
 * Frontend renders a dedicated tool-card for this tool id with a "下载
 * .docx" button.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

/**
 * Remove HTML tags for a plain-text representation that the frontend can
 * flow into docx paragraphs. Preserves block breaks by substituting </p>
 * and <br> with newlines BEFORE stripping remaining tags.
 */
function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const exportScripts = createTool({
  id: "export_scripts",
  description:
    '把当前项目所有剧集的剧本打包给用户下载（.docx）。用户说"导出剧本 / 下载剧本 / 把所有剧本导出"时调。返回每集的 title + plain text；**实际的 .docx 生成和下载在前端完成**，你只需要给用户一句"剧本已准备好，点下方按钮下载"即可。',
  inputSchema: z.object({
    /**
     * Optional subset — if provided, only export these episodes. Default is
     * all. Useful for "导出第 1-5 集" narrow asks; LLM fetches ids from
     * query_context first.
     */
    episodeIds: z
      .array(z.string())
      .optional()
      .describe("可选：只导出这些 episode id；不传就导出全部"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    projectName: z.string(),
    filename: z.string(),
    episodeCount: z.number(),
    totalChars: z.number(),
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        title: z.string(),
        content: z.string(),
      })
    ),
    message: z.string(),
  }),
  execute: async ({ episodeIds }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    // Project name → filename; fall back to "scripts" if detail fetch fails.
    let projectName = "scripts";
    try {
      const detail = await javaRequest<{ name?: string }>(
        ctx,
        `/api/user/project/detail/${ctx.projectId}`
      );
      if (typeof detail.name === "string" && detail.name.trim()) {
        projectName = detail.name.trim();
      }
    } catch {
      // leave as default
    }

    // List episodes, filter + sort by `sort`.
    const listed = await javaRequest<{
      list?: Array<{ id: string | number; title?: string; sort?: number }>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: ctx.projectId, page: 1, pageSize: 999 },
    });
    const all = (listed.list ?? [])
      .map((ep) => ({
        id: String(ep.id),
        title: String(ep.title ?? ""),
        sort: Number(ep.sort ?? 0),
      }))
      .sort((a, b) => a.sort - b.sort);
    const filter = episodeIds?.length ? new Set(episodeIds) : null;
    const targets = filter ? all.filter((ep) => filter.has(ep.id)) : all;

    if (targets.length === 0) {
      return {
        ok: false,
        projectName,
        filename: "",
        episodeCount: 0,
        totalChars: 0,
        episodes: [],
        message: "当前项目没有可导出的剧本。",
      };
    }

    // Fetch scripts in parallel (cheap Java GETs).
    const episodes = await Promise.all(
      targets.map(async (ep) => {
        try {
          const res = await javaRequest<{ content?: string; script?: string }>(
            ctx,
            `/api/user/project/scripts/episode/detail/${encodeURIComponent(ep.id)}`
          );
          const raw = res.content ?? res.script ?? "";
          return {
            episodeId: ep.id,
            title: ep.title || `第 ${targets.indexOf(ep) + 1} 集`,
            content: htmlToPlainText(raw),
          };
        } catch {
          return { episodeId: ep.id, title: ep.title, content: "" };
        }
      })
    );

    const nonEmpty = episodes.filter((e) => e.content.trim().length > 0);
    const totalChars = nonEmpty.reduce((sum, e) => sum + e.content.length, 0);
    const filename = `${projectName}-all-scripts.docx`;

    return {
      ok: nonEmpty.length > 0,
      projectName,
      filename,
      episodeCount: nonEmpty.length,
      totalChars,
      episodes,
      message:
        nonEmpty.length > 0
          ? `已准备好 ${nonEmpty.length} 集剧本（约 ${totalChars.toLocaleString()} 字），点击卡片上的按钮可以下载 ${filename}。`
          : "所有剧集的剧本都是空的，无法导出。",
    };
  },
});
