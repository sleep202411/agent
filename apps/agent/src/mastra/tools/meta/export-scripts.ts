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
    'Bundle every episode\'s script in the current project for the user to download as a .docx. Call when the user says "export scripts / download scripts / export all scripts". Returns each episode\'s title + plain text; **the actual .docx generation and download happen in the frontend**, so just tell the user "the scripts are ready — click the button below to download".',
  inputSchema: z.object({
    /**
     * Optional subset — if provided, only export these episodes. Default is
     * all. Useful for "export episodes 1-5" narrow asks; LLM fetches ids
     * from query_context first.
     */
    episodeIds: z
      .array(z.string())
      .optional()
      .describe("Optional: only export these episode ids; omit to export all"),
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
        message: "This project has no scripts to export.",
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
            title: ep.title || `Episode ${targets.indexOf(ep) + 1}`,
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
          ? `Prepared ${nonEmpty.length} scripts (~${totalChars.toLocaleString()} characters). Click the button on the card to download ${filename}.`
          : "All episode scripts are empty — nothing to export.",
    };
  },
});
