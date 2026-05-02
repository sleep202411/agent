/**
 * script_breakdown — Step 1 of the production pipeline.
 *
 * Owned by the storyEditor persona (剧本统筹 / Story Editor). Compresses raw
 * source material (novels, outlines, draft scripts) into a structured
 * narrative skeleton: chapter structure + threads + cast roster + settings
 * roster. Does NOT do character or scene design — those are downstream
 * personas' jobs. The skeleton is a shared artifact that all subsequent
 * phases (role_phase / episode_phase / script_phase / storyboard_phase) read
 * from instead of re-analyzing raw text.
 *
 * No HITL here — skeleton extraction is a pure transform. HITL gates live in
 * the phase workflows that consume this skeleton.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { reportProgress, throwIfCancelled } from "../engine";
import { putOutline, type StoryOutline } from "../../lib/outline";
import { getContext, javaRequest, type StoryosContext } from "../../lib/workspace-client";
import { publishWorkflowCompleted, publishWorkflowProgress } from "../../lib/workflow-messages";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import { contentLanguageInstruction, resolveContentLanguage } from "../../lib/language";

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * DeepSeek sometimes emits arrays where we expect a single string.
 * Coerce by joining with a comma so the field stays a single string.
 */
const stringLike = z.preprocess((val) => {
  if (Array.isArray(val)) return val.map((v) => String(v)).join(", ");
  return val;
}, z.string().min(1));

/**
 * "Optional string" that also tolerates explicit `null` from the LLM.
 * `z.string().optional()` rejects null — but DeepSeek v4-pro routinely
 * writes `null` for fields it considered-but-skipped (e.g. last chapter's
 * `hookToNext`), where v4-flash tends to omit the key entirely. Rather
 * than tune around model differences, accept either shape and normalise
 * to `undefined` so downstream consumers see a single missing-value
 * representation.
 */
const optionalString = z
  .string()
  .nullish()
  .transform((v) => (v == null || v === "" ? undefined : v));

const KeyEventsSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return val.split(/[、,，]\s*/).filter(Boolean);
    return val;
  },
  z.array(z.string().min(1)).min(1)
);

/**
 * LLMs (especially DeepSeek/Qwen) frequently overshoot short-name caps,
 * writing a full sentence where we asked for a label. Hard-failing the whole
 * structured-output validation for one over-long name is way too brittle —
 * we silently truncate at the cap so the run survives. Whitespace-trim first
 * so leading/trailing spaces don't eat into the budget.
 */
function truncateName(maxLen: number) {
  return (val: unknown) => {
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  };
}

const ChapterSchema = z.object({
  chapterId: z.string().min(1),
  title: z.string().min(1).max(80),
  summary: stringLike,
  keyEvents: KeyEventsSchema,
  emotion: stringLike,
  hookToNext: optionalString,
});

const SubThreadSchema = z.object({
  name: z.preprocess(truncateName(30), z.string().min(1).max(30)),
  description: stringLike,
  linkedChapterIds: z.array(z.string()).optional(),
});

const ThreadsSchema = z.object({
  main: stringLike,
  subs: z.array(SubThreadSchema).default([]),
});

/**
 * Cast roster — NAME + role + one-line arc only. No appearance / personality.
 * The character designer persona elaborates from this in role_phase.
 *
 * DeepSeek occasionally drops `role` or `arc` on secondary cast entries when
 * it races through the tail of a long list. We preprocess to fill in
 * "not specified in source" (matches the persona's own fallback instruction)
 * so one missing sub-field doesn't nuke the whole run.
 */
const CastRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      role: obj.role ?? "not specified in source",
      arc: obj.arc ?? "not specified in source",
    };
  },
  z.object({
    name: z.preprocess(truncateName(20), z.string().min(1).max(20)),
    role: stringLike,
    arc: stringLike,
    firstAppearance: optionalString,
  })
);

/**
 * Settings roster — NAME + type hint only. No atmosphere / lighting /
 * specific dressing. The scene designer persona elaborates from this.
 */
const SettingsRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      typeHint: obj.typeHint ?? "unspecified",
    };
  },
  z.object({
    name: z.preprocess(truncateName(30), z.string().min(1).max(30)),
    typeHint: stringLike,
    firstAppearance: optionalString,
  })
);

/**
 * Props roster — NAME + type hint only. No detailed design / materials.
 * The prop designer persona elaborates from this.
 */
const PropsRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      typeHint: obj.typeHint ?? "unspecified",
    };
  },
  z.object({
    name: z.preprocess(truncateName(30), z.string().min(1).max(30)),
    typeHint: stringLike,
    firstAppearance: optionalString,
  })
);

const BreakdownShape = z.object({
  storySummary: z.preprocess((val) => {
    if (Array.isArray(val)) return val.map((v) => String(v)).join(" ");
    return val;
  }, z.string().min(30)),
  genre: z.string().min(1),
  tone: z.string().min(1),
  structure: z.array(ChapterSchema).min(1),
  threads: ThreadsSchema,
  cast: z.array(CastRosterEntrySchema).min(1),
  settings: z.array(SettingsRosterEntrySchema).default([]),
  props: z.array(PropsRosterEntrySchema).default([]),
});

export const ScriptBreakdownInputSchema = z.object({
  /**
   * Raw text to analyze — novel chapters, outline, draft script, etc.
   * Optional: if omitted, story_outline falls back to concatenating
   * already-committed episode scripts from Java (the post-parse_script
   * "走完整资产" path, where user already has episodes in DB and just
   * wants skeleton extracted from them).
   */
  text: optionalString,
  /** Optional user hint to steer tone / genre ("爱情喜剧" / "悬疑惊悚" etc.) */
  styleHint: optionalString,
  /**
   * Output language for the generated skeleton (chapter titles, cast
   * name-hints, settings names, thread summaries). Resolved by the
   * supervisor from project dialogLanguage / user locale; defaults to
   * English when omitted.
   */
  contentLanguage: optionalString,
});

/** Pulls committed episode scripts from Java and concats them into the
 *  raw text story_outline needs. Used when caller didn't pass `text`
 *  (post parse_script flow). */
async function loadTextFromCommittedEpisodes(ctx: StoryosContext): Promise<string> {
  type Ep = { id: string | number; title?: string; sort?: number };
  const listed = await javaRequest<{ list?: Ep[] }>(ctx, "/api/user/world/list/episode", {
    data: { productId: ctx.projectId, page: 1, pageSize: 999 },
  });
  const episodes = (listed.list ?? [])
    .filter((ep) => ep.id != null)
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  if (episodes.length === 0) return "";
  const parts = await Promise.all(
    episodes.map(async (ep, i) => {
      try {
        const res = await javaRequest<{ content?: string; script?: string }>(
          ctx,
          `/api/user/project/scripts/episode/detail/${encodeURIComponent(String(ep.id))}`
        );
        const raw = res.content ?? res.script ?? "";
        const plain = htmlToPlainText(raw);
        if (!plain.trim()) return "";
        const header = `## Episode ${i + 1} ${ep.title ?? ""}`.trim();
        return `${header}\n\n${plain}`;
      } catch {
        return "";
      }
    })
  );
  return parts.filter(Boolean).join("\n\n---\n\n");
}

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

export const ScriptBreakdownOutputSchema = BreakdownShape;

// ─── Single step (analyst call) ───────────────────────────────────────

const analyzeStep = createStep({
  id: "analyze",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    const ctx = getContext(requestContext);
    if (runId) {
      await throwIfCancelled(runId);
      const startLabel = "Story editor is breaking down the source material…";
      await reportProgress(runId, {
        stepId: "analyze",
        current: 0,
        total: 1,
        label: startLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "story_outline", "planning", {
        current: 0,
        total: 1,
        label: startLabel,
      });
    }

    // Resolve the text to analyze: LLM-supplied first, fall back to
    // committed-episode scripts (post parse_script "走完整资产" path).
    let effectiveText = inputData.text?.trim() ?? "";
    if (!effectiveText) {
      effectiveText = await loadTextFromCommittedEpisodes(ctx);
      if (!effectiveText) {
        throw new Error(
          "story_outline: no text provided and no committed episodes to source from — run parse_script first or pass `text` explicitly"
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[script_breakdown] sourced ${effectiveText.length} chars from committed episodes for project ${ctx.projectId}`
      );
    }

    const storyEditor = mastra?.getAgent("storyEditor");
    if (!storyEditor) throw new Error("storyEditor agent not registered");

    const prompt = buildStoryEditorPrompt({
      text: effectiveText,
      styleHint: inputData.styleHint,
      contentLanguage: resolveContentLanguage(inputData.contentLanguage, ctx.dialogLanguage),
    });

    // eslint-disable-next-line no-console
    console.log(`[script_breakdown] storyEditor prompt length: ${prompt.length} chars`);

    // DeepSeek (especially v4-pro) intermittently returns an empty
    // structured-output object — zod then fails with `root: Required`.
    // The model is healthy on the *next* call ~95% of the time, so a
    // single retry silently recovers most of these without surfacing a
    // failure card. Two attempts max: any third failure is real (key
    // misconfig / model down / prompt refusal) and shouldn't keep
    // burning tokens.
    const MAX_ATTEMPTS = 2;
    let response: Awaited<ReturnType<typeof storyEditor.generate>>;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await storyEditor.generate(prompt, {
          structuredOutput: {
            schema: BreakdownShape,
            // Surface schema-mismatch errors instead of silently returning
            // undefined — otherwise we only see "no cast" with no cause.
            errorStrategy: "strict",
          },
        });
        if (attempt > 1) {
          console.log(
            `[script_breakdown] storyEditor recovered on attempt ${attempt}/${MAX_ATTEMPTS}`
          );
        }
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[script_breakdown] storyEditor attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`
        );
        if (attempt === MAX_ATTEMPTS) break;
        // Tiny backoff so we don't hammer DeepSeek on the rare case
        // they're throttling us. 500ms is enough for a transient.
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (lastErr) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] storyEditor.generate exhausted retries:",
        lastErr instanceof Error ? lastErr.message : lastErr,
        lastErr instanceof Error ? lastErr.stack : undefined
      );
      throw lastErr;
    }
    response = response!;

    const result = response.object as z.infer<typeof BreakdownShape> | undefined;
    if (!result || !result.cast || result.cast.length === 0) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] storyEditor returned no cast. Raw response keys:",
        Object.keys(response ?? {}),
        "text head:",
        typeof response.text === "string" ? response.text.slice(0, 500) : "(no .text)",
        "object:",
        JSON.stringify(response.object ?? null).slice(0, 500)
      );
      throw new Error("storyEditor returned no cast — skeleton extraction failed");
    }

    if (runId) {
      // Progress label stays a plain (English) string — only shown in the
      // transient progress bar. User-visible completion summary goes
      // through summaryKey below.
      const chaptersCount = result.structure.length;
      const rolesCount = result.cast.length;
      const scenesCount = result.settings?.length ?? 0;
      const endLabel = `Outline ready: ${chaptersCount} chapters · ${rolesCount} characters · ${scenesCount} scenes`;
      await reportProgress(runId, {
        stepId: "analyze",
        current: 1,
        total: 1,
        label: endLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "story_outline", "planning", {
        current: 1,
        total: 1,
        label: endLabel,
      });
      // Charge for the outline run — no HITL, so deduct once on success.
      // Fixed price (not draft-count-based) because the product here is a
      // single skeleton, not a collection of items.
      await deductCredits(ctx, {
        amount: PRICES.storyOutlineRun,
        reason: `story_outline runId=${runId}`,
        idempotencyKey: phaseDeductKey(runId, "story_outline"),
      });
      // story_outline has no HITL — outline is a deterministic skeleton.
      // User picks the next step explicitly (full flow starts with role
      // phase; "just outline" users stop here).
      await publishWorkflowCompleted(ctx.projectId, runId, "story_outline", {
        committed: [{ serverId: ctx.projectId, title: "Story skeleton" }],
        summaryKey: "storyOutlineSummary",
        summaryParams: {
          chapters: chaptersCount,
          roles: rolesCount,
          scenes: scenesCount,
        },
        // Attach the structured skeleton so the completed card can show
        // chapter titles / cast / settings inline — users were seeing
        // just "5 章 · 5 角色 · 5 场景" with no way to glimpse the actual
        // content.
        result: {
          storySummary: result.storySummary,
          genre: result.genre,
          tone: result.tone,
          structure: result.structure.map((c) => ({ title: c.title, summary: c.summary })),
          cast: result.cast.map((c) => ({ name: c.name, role: c.role })),
          settings: (result.settings ?? []).map((s) => ({
            name: s.name,
            typeHint: s.typeHint,
          })),
        },
        nextSteps: [
          {
            workflowName: "role_phase",
            labelKey: "workflowNextContinueToRoles",
            variant: "primary",
          },
        ],
      });
    }

    return result;
  },
});

function buildStoryEditorPrompt(input: {
  text?: string;
  styleHint?: string;
  contentLanguage: string;
}): string {
  const styleBlock = input.styleHint ? `\n\nUser-supplied style hint: ${input.styleHint}\n` : "";
  return [
    "Do a **story-editor-level skeleton breakdown** of the source material below. Produce only structure / threads / rosters — **do not** do detailed character or scene design. Follow the agreed JSON schema strictly.",
    "",
    "```",
    input.text,
    "```",
    styleBlock,
    "",
    "Core requirements:",
    "1. `structure` must cover the entire source. Chapter division should be reasonable (short pieces: 3-5 chapters; mid-length: 5-15; long-form: follow the source's own chapters).",
    "2. `cast` is a **roster only** (name + role + one-line arc). Do not write appearance / personality / dialogue — that is the character designer's next step.",
    "3. `settings` is the same: roster of locations + typeHint only. Do not write atmosphere / lighting / dressing.",
    "4. `props` lists objects that **explicitly appear and are interacted with** by characters, plus a typeHint. Includes but isn't limited to: identity tokens (jade pendants, official seals, plaques, crowns), key evidence (letters, portraits, journals, photographs), trigger objects (transmigration keys, contracts, rings, antiques), weapons or tools, keepsakes (love tokens, heirlooms), recurring props (pipes, folding fans, medicine bottles). If the plot mentions it and it advances the story / distinguishes a character / carries emotion, include it (the user reviews next). Exclude only pure background dressing (tables, chairs, single-use food and drink). **Typically 3-8 entries; return an empty array only for highly abstract narratives, pure single-set dialogue plays, or similar.**",
    "5. `threads.main` must capture the through-line of the whole source. `subs` lists interwoven side threads.",
    contentLanguageInstruction(input.contentLanguage),
  ].join("\n");
}

// ─── Persist step — write skeleton to Redis keyed by projectId ──────

const persistStep = createStep({
  id: "persist",
  inputSchema: ScriptBreakdownOutputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";
    try {
      await putOutline(ctx.projectId, inputData as StoryOutline, { runId });
    } catch (err) {
      // Persistence failure shouldn't kill the workflow — the skeleton is
      // still returned in the run result, just not cached for downstream
      // phases. Downstream can gracefully fall back to regenerate.
      // eslint-disable-next-line no-console
      console.warn(
        "[story_outline] persist failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return inputData;
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptBreakdownWorkflow = createWorkflow({
  id: "story_outline",
  description:
    "Story editing: read raw material → compress into a story skeleton (chapters / threads / cast roster / settings roster) and persist to Redis for downstream phases.",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
})
  .then(analyzeStep)
  .then(persistStep)
  .commit();

export type ScriptBreakdownOutput = z.infer<typeof ScriptBreakdownOutputSchema>;
