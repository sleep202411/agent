/**
 * Shared plumbing for "ask_*" tools — the direct-call path where the
 * supervisor consults a single persona without spinning up a workflow.
 *
 * Contract (unified 2026-04-23):
 *   Persona agents always return `{ summary, fields }` via Mastra's
 *   structuredOutput — NOT free-form text.
 *   - `summary` is a short markdown prose description for the user
 *     (rendered in ToolPersonaCard).
 *   - `fields` is the structured payload supervisor pipes straight into
 *     `batch_create_character/scene/prop` tool args — NO prose→fields
 *     extraction step. That's what used to mangle Chinese quotes into
 *     ASCII and break JSON parsing; handing supervisor pre-structured
 *     fields sidesteps the whole failure class.
 *
 * Workflows (role_design / role_phase / etc.) use their own
 * structuredOutput schemas at the call site and are unaffected.
 */
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

export const DEFAULT_ASK_TIMEOUT_MS = 30_000;

/**
 * Persona reply fields — intentionally open. Each persona's own prompt
 * decides what keys to fill (role/scene/prop → {name, description,
 * prompt}; storyboarder → {scene, description, image_prompt, ...};
 * art-director → empty, discussion-only). Supervisor reads the
 * appropriate keys based on which persona it asked.
 *
 * Kept open so the LLM doesn't have to awkwardly wrap or rename its
 * natural JSON output just to fit a closed schema — that was the root
 * cause of Mastra returning response.object=null on shot designs.
 */
export const PersonaReplyFieldsSchema = z.record(z.unknown());

export type PersonaReplyFields = z.infer<typeof PersonaReplyFieldsSchema>;

export const PersonaReplyShapeSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "一句到两段的 markdown prose，面向用户展示（ToolPersonaCard 渲染）。**所有 persona 都必须填**。对设计类 persona 讲最有辨识度的亮点；对讨论/建议类 persona 直接写你的意见。"
    ),
  fields: PersonaReplyFieldsSchema.optional().describe(
    "结构化数据，供 supervisor 直接喂给下游 atomic tool（batch_create_* / add_shot 等）。key 由你的角色决定：角色师 → {name, description, prompt}；场景师 → {name, description, prompt}；道具师 → {name, description, prompt}；分镜师 → {scene, description, image_prompt, video_prompt, movement, shot_size, perspective, dialogue, duration}；评审/讨论类 persona 留空。**字符串里的引号一律用中文引号「」，禁止 ASCII 双引号避免 supervisor 转嵌时 JSON 破损。**"
  ),
});

export type PersonaReplyShape = z.infer<typeof PersonaReplyShapeSchema>;

interface AgentLike {
  generate(
    input: string,
    opts?: Record<string, unknown>
  ): Promise<{ object?: unknown; text?: unknown }>;
}
interface MastraLike {
  getAgent(id: string): AgentLike | undefined;
}

export interface AskPersonaResult {
  persona: string;
  summary: string;
  fields: PersonaReplyFields | null;
  tookMs: number;
  /** Bytes of context injected into the prompt (for cost observability). */
  contextBytes: number;
  /** Populated when the LLM call failed, timed out, or returned an object
   *  that didn't match PersonaReplyShapeSchema. */
  error?: string;
}

export interface AskPersonaOptions {
  mastra: MastraLike | undefined;
  requestContext: RequestContext | undefined;
  agentId: string;
  task: string;
  contextBlocks: Array<{ heading: string; body: string }>;
  timeoutMs?: number;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function composePrompt(task: string, blocks: Array<{ heading: string; body: string }>): string {
  const parts: string[] = [`【用户请求】\n${task.trim()}`];
  for (const b of blocks) {
    if (!b.body?.trim()) continue;
    parts.push(`【${b.heading}】\n${b.body.trim()}`);
  }
  return parts.join("\n\n");
}

function errorResult(
  agentId: string,
  startedAt: number,
  contextBytes: number,
  error: string
): AskPersonaResult {
  return {
    persona: agentId,
    summary: "",
    fields: null,
    tookMs: Date.now() - startedAt,
    contextBytes,
    error,
  };
}

export async function askPersona(opts: AskPersonaOptions): Promise<AskPersonaResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  const prompt = composePrompt(opts.task, opts.contextBlocks);
  const contextBytes = prompt.length;

  const agent = opts.mastra?.getAgent(opts.agentId);
  if (!agent) {
    const error = `persona agent "${opts.agentId}" not registered`;
    console.warn("[ask-persona]", error);
    return errorResult(opts.agentId, startedAt, contextBytes, error);
  }

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    console.info(
      `[ask-persona] → ${opts.agentId}: task=${opts.task.slice(0, 80).replace(/\n/g, " ")}… ctxBytes=${contextBytes}`
    );
    const response = await agent.generate(prompt, {
      requestContext: opts.requestContext,
      abortSignal: abortController.signal,
      structuredOutput: {
        schema: PersonaReplyShapeSchema,
        // warn instead of throw — Mastra returns whatever it got and we
        // do our own safeParse below. Throwing would force unhelpful
        // internal retries that may not converge.
        errorStrategy: "warn",
      },
    });
    let parsed = PersonaReplyShapeSchema.safeParse(response.object);

    // Recovery: if the LLM skipped wrapping and produced a flat object of
    // domain fields (common with storyboarder), treat the whole payload as
    // `fields` and synthesize a summary from its description-ish key. This
    // tolerates LLMs that can't reliably wrap their output into the
    // {summary, fields} envelope even after explicit prompting.
    if (!parsed.success) {
      const rawText = typeof response.text === "string" ? response.text : "";
      const rawObj =
        response.object && typeof response.object === "object"
          ? (response.object as Record<string, unknown>)
          : tryParseJson(rawText);
      if (rawObj && typeof rawObj === "object" && !Array.isArray(rawObj)) {
        const record = rawObj as Record<string, unknown>;
        const alreadyWrapped = typeof record.summary === "string" && record.summary.length > 0;
        if (!alreadyWrapped) {
          const synth =
            (typeof record.description === "string" && record.description) ||
            (typeof record.setting === "string" && record.setting) ||
            (typeof record.image_prompt === "string" && record.image_prompt) ||
            "";
          const wrapped = { summary: synth || "（persona 未提供摘要）", fields: record };
          const retry = PersonaReplyShapeSchema.safeParse(wrapped);
          if (retry.success) {
            parsed = retry;
            console.info(
              `[ask-persona] ⤷ ${opts.agentId} auto-wrapped flat output into {summary, fields}`
            );
          }
        }
      }
    }

    if (!parsed.success) {
      const tookMs = Date.now() - startedAt;
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") || "<root>";
      const err = `persona "${opts.agentId}" returned malformed output: ${path} ${issue?.message ?? ""}`;
      try {
        const fs = await import("node:fs/promises");
        await fs.writeFile(
          `/tmp/ask-persona-${opts.agentId}-${Date.now()}.json`,
          JSON.stringify(
            {
              agentId: opts.agentId,
              error: err,
              responseObject: response.object ?? null,
              responseText: response.text ?? null,
            },
            null,
            2
          )
        );
      } catch {
        /* ignore */
      }
      const objPreview = JSON.stringify(response.object ?? null).slice(0, 200);
      const textPreview = String(response.text ?? "").slice(0, 200);
      console.warn(
        `[ask-persona] ✕ ${opts.agentId} (${tookMs}ms) ${err} | object=${objPreview} | text=${textPreview}`
      );
      return errorResult(opts.agentId, startedAt, contextBytes, err);
    }
    const tookMs = Date.now() - startedAt;
    const fieldsChars = parsed.data.fields ? JSON.stringify(parsed.data.fields).length : 0;
    console.info(
      `[ask-persona] ← ${opts.agentId} (${tookMs}ms, summary=${parsed.data.summary.length}, fields=${parsed.data.fields ? fieldsChars : "no"})`
    );
    return {
      persona: opts.agentId,
      summary: parsed.data.summary,
      fields: parsed.data.fields ?? null,
      tookMs,
      contextBytes,
    };
  } catch (err) {
    const tookMs = Date.now() - startedAt;
    const aborted = abortController.signal.aborted;
    const error = aborted
      ? `persona "${opts.agentId}" timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    console.warn(`[ask-persona] ✕ ${opts.agentId} (${tookMs}ms) ${error}`);
    return errorResult(opts.agentId, startedAt, contextBytes, error);
  } finally {
    clearTimeout(timer);
  }
}
