/**
 * save_episode_script / batch_save_episode_scripts — direct-commit tools
 * for episode script bodies.
 *
 * Why this exists: `ask_scriptwriter` returns a draft for the user to
 * review, but until now there was no meta-tool that persists the result.
 * The supervisor honestly told the user "no save tool exists" and either
 * stuffed the script into `update_episode.introduction` (clobbering the
 * 1-3 sentence synopsis) or left the draft in chat where it'd scroll
 * away. Java's `/api/user/project/scripts/episode/createOrUpdate` has
 * always supported writing `{ episodeId, content }`; the workflows
 * (script-edit, script-phase, parse-script, produce.ts) all hit it. This
 * tool exposes the same path to the supervisor's tool surface.
 *
 * Storage shape: Java's editor is Tiptap-backed, so `content` lives as
 * HTML — one `<p>` per non-empty line. We do the same plain-text →
 * `<p>line</p>` conversion the workflow paths use; supervisors / personas
 * never see this serialization.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishEntityEvent } from "../../lib/entity-events";

/**
 * Plain-text → Tiptap HTML. Identical to the helpers duplicated across
 * `workflows/parse-script.ts`, `workflows/phases/script-phase.ts`, and
 * `routes/produce.ts`. Kept in lockstep so a script saved through any
 * path renders identically in the editor.
 */
function scriptToTiptapHtml(text: string): string {
  const escaped = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escaped(line)}</p>`)
    .join("\n");
}

// ─── save_episode_script ───────────────────────────────────────────────

export const saveEpisodeScript = createTool({
  id: "save_episode_script",
  description:
    'Save (create or replace) one episode\'s full script body in Java. Direct write — no draft gate, no HITL. Use after `ask_scriptwriter` returns a complete episode draft and the user has confirmed they want to keep it (typical trigger: user clicked the "Save script" button on a scriptwriter proposal, or said "保存这版剧本 / 入库 / 就这版"). `episodeId` comes from the workspace context or `query_context(summary).episodes`. `content` is the full script as plain text (one element per line — timecodes, [VISUAL], dialogue lines, etc.); the tool wraps each line as a Tiptap `<p>` for the Java editor. **Do not use** for tiny one-line edits to an existing script — invoke `script_edit` workflow for that, which preserves the rest verbatim. **Do not use** for episode metadata (title / synopsis) — that is `update_episode`.',
  inputSchema: z.object({
    // Optional — falls back to ctx.episodeId (from <WORKSPACE_CONTEXT>) if
    // omitted. See add-shot.ts header for full rationale.
    episodeId: z
      .string()
      .optional()
      .describe(
        "Java episode id. Optional — auto-resolved from WORKSPACE_CONTEXT if the user is currently editing an episode."
      ),
    content: z
      .string()
      .min(1)
      .describe(
        "Full script body as plain text. One element per line: timecode header, [VISUAL] action, [SFX/AMBIENT] cue, dialogue line, etc. Blank lines are dropped during HTML conversion."
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    chars: z.number(),
    message: z.string(),
  }),
  execute: async ({ episodeId, content }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    const effectiveEpisodeId = episodeId ?? ctx.episodeId;
    if (!effectiveEpisodeId) {
      return {
        ok: false,
        chars: 0,
        message:
          "episodeId is required and not in the workspace context. Ask the user which episode this script belongs to before saving.",
      };
    }

    const html = scriptToTiptapHtml(content);
    if (!html) {
      return {
        ok: false,
        chars: 0,
        message: "Script content was empty after trimming — nothing to save.",
      };
    }
    try {
      await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/createOrUpdate", {
        data: { episodeId: effectiveEpisodeId, content: html },
        timeoutMs: 120_000,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        chars: content.length,
        message: `Java write failed: ${reason}`,
      };
    }
    await publishEntityEvent(ctx, {
      entity: "script",
      action: "updated",
      id: effectiveEpisodeId,
      episodeId: effectiveEpisodeId,
      source: "save_episode_script",
    });
    return {
      ok: true,
      chars: content.length,
      message: `Saved script for episode ${effectiveEpisodeId} (${content.length} chars).`,
    };
  },
});

// ─── batch_save_episode_scripts ────────────────────────────────────────

export const batchSaveEpisodeScripts = createTool({
  id: "batch_save_episode_scripts",
  description:
    'Save scripts for multiple episodes in one call. Use when the user has confirmed a multi-episode scriptwriter pass ("保存这 3 集的剧本"). For a single episode use `save_episode_script`. Each item is `{ episodeId, content }`; ordering is irrelevant (every entry is a full replace).',
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          episodeId: z.string(),
          content: z.string().min(1),
        })
      )
      .min(1)
      .max(50),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    saved: z.array(z.object({ episodeId: z.string(), chars: z.number() })),
    message: z.string(),
  }),
  execute: async ({ items }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const projectId = ctx.projectId;
    if (!projectId) {
      return {
        ok: false,
        saved: [],
        message: "projectId missing from context — cannot save scripts.",
      };
    }
    const episodeIds = items.map((it) => it.episodeId);
    const contents = items.map((it) => scriptToTiptapHtml(it.content));
    try {
      await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/batch/createOrUpdate", {
        data: { projectId, episodeIds, contents },
        timeoutMs: 300_000,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        saved: [],
        message: `Java batch write failed: ${reason}`,
      };
    }
    await publishEntityEvent(ctx, {
      entity: "script",
      action: "batch_updated",
      source: "batch_save_episode_scripts",
    });
    return {
      ok: true,
      saved: items.map((it) => ({ episodeId: it.episodeId, chars: it.content.length })),
      message: `Saved ${items.length} episode scripts.`,
    };
  },
});
