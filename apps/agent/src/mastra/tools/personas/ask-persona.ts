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

/**
 * Per-persona-call deadline. We're generous on purpose: heavy
 * structured-JSON tasks on `alibaba/qwen3.6-plus` (storyboarder with 6
 * shots × 10 fields, scene-designer with 8 scenes, scriptwriter with a
 * full-episode script + uploaded source material) routinely take 60-150s
 * end-to-end. The previous 30s ceiling caused `<root> Required` /
 * `object=null` cascades when the model was still mid-generation when
 * the abort fired.
 *
 * 240s is the new default. It's intentionally bigger than typical p99
 * persona latency so a slow turn completes rather than fails — we'd
 * rather make the user wait once than show them a malformed-output
 * error. Tuneable via `STORYOS_ASK_TIMEOUT_MS` env.
 */
export const DEFAULT_ASK_TIMEOUT_MS = Number(process.env.STORYOS_ASK_TIMEOUT_MS ?? 240_000);

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
      "One-sentence to two-paragraph markdown prose shown to the user (rendered by ToolPersonaCard). **Required for every persona.** For design personas, call out the most distinctive aspects; for discussion / advisory personas, write your opinion directly."
    ),
  fields: PersonaReplyFieldsSchema.optional().describe(
    "Structured payload the supervisor feeds straight to downstream atomic tools (batch_create_* / add_shot etc.). Keys are persona-specific: character designer → {name, description, prompt}; scene designer → {name, description, prompt}; prop designer → {name, description, prompt}; storyboarder → {scene, description, image_prompt, video_prompt, movement, shot_size, perspective, dialogue, duration}; review / discussion personas leave it empty. **Always use curly quotes “” inside string values, never ASCII double quotes — ASCII quotes break the supervisor's JSON wrapping.**"
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
  const parts: string[] = [`[User request]\n${task.trim()}`];
  for (const b of blocks) {
    if (!b.body?.trim()) continue;
    parts.push(`[${b.heading}]\n${b.body.trim()}`);
  }
  // DashScope / qwen has a preflight check: when `response_format` is
  // `json_object` the messages array MUST contain the literal word
  // "json" or the API rejects with InvalidParameter (400). Mastra's
  // `structuredOutput` translates to `response_format: json_object` for
  // non-OpenAI providers, so without this nudge every persona call to
  // alibaba blows up before reaching the model. The trailing footer
  // is harmless on Anthropic / DeepSeek paths — it just reinforces the
  // expected output shape.
  parts.push(
    "[Response format]\nReturn a JSON object that matches the structuredOutput schema exactly."
  );
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
          // Prefer narrative fields when synthesising a summary —
          // image-model `prompt` strings are visual tokens (commas
          // and adjectives) and read terribly when shown alone in
          // the chat card. A persona that forgets the {summary,
          // fields} envelope but emits {name, role, personality,
          // appearance, prompt} should still surface as
          // "personality" rather than a 200-char-cropped image-prompt
          // blurb. Order: narrative-richest → next-richest →
          // visual-prompt as last resort → longest other string.
          const pickString = (key: string): string =>
            typeof record[key] === "string" ? (record[key] as string) : "";
          const namedSynth =
            pickString("personality") ||
            pickString("description") ||
            pickString("appearance") ||
            pickString("setting") ||
            pickString("introduction") ||
            pickString("synopsis") ||
            pickString("content") ||
            pickString("prompt") ||
            pickString("image_prompt") ||
            "";
          let bestStringSynth = "";
          if (!namedSynth) {
            for (const value of Object.values(record)) {
              if (typeof value === "string" && value.length > bestStringSynth.length) {
                bestStringSynth = value;
              }
            }
            // Last-resort drill: if no top-level strings exist (e.g. an
            // episode-planner output of `{ episodes: [{introduction}, ...] }`),
            // pluck a narrative string out of the first entry of any
            // top-level array. Without this the card falls back to the
            // literal "(persona did not provide a summary)" placeholder
            // even though the persona's data is perfectly usable.
            if (!bestStringSynth) {
              for (const value of Object.values(record)) {
                if (!Array.isArray(value) || value.length === 0) continue;
                const first = value[0];
                if (!first || typeof first !== "object") continue;
                const f = first as Record<string, unknown>;
                const candidate =
                  (typeof f.introduction === "string" && f.introduction) ||
                  (typeof f.description === "string" && f.description) ||
                  (typeof f.summary === "string" && f.summary) ||
                  (typeof f.title === "string" && f.title) ||
                  "";
                if (typeof candidate === "string" && candidate.length > 0) {
                  bestStringSynth = candidate;
                  break;
                }
              }
            }
          }
          const raw = (namedSynth || bestStringSynth || "").trim();
          // Trim to ~280 chars but break on sentence / clause boundary
          // so the chat card doesn't end mid-word ("...standing
          // upright facing camera, head" was the original symptom).
          const synth = (() => {
            if (raw.length <= 280) return raw;
            const cut = raw.slice(0, 280);
            const lastSentence = Math.max(
              cut.lastIndexOf("。"),
              cut.lastIndexOf("."),
              cut.lastIndexOf("!"),
              cut.lastIndexOf("?"),
              cut.lastIndexOf("！"),
              cut.lastIndexOf("？")
            );
            if (lastSentence > 100) return cut.slice(0, lastSentence + 1);
            const lastClause = Math.max(
              cut.lastIndexOf("，"),
              cut.lastIndexOf(","),
              cut.lastIndexOf("、"),
              cut.lastIndexOf("；"),
              cut.lastIndexOf(";")
            );
            return lastClause > 60 ? `${cut.slice(0, lastClause)}…` : `${cut}…`;
          })();
          // Last-ditch fallback. Earlier this was a literal "(persona did
          // not provide a summary)" placeholder that read terribly in the
          // chat card. Now: if we recovered fields successfully, signal
          // that the structured preview below carries the answer rather
          // than displaying an apology line. The frontend renders
          // `fields` regardless of summary content.
          const wrapped = {
            summary: synth || "见下方结构化结果。",
            fields: record,
          };
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
