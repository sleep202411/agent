/**
 * Produce script pipeline — end-to-end analysis for the dedicated
 * /produce/script page.
 *
 * Important boundary: this workflow does not write Java business data.
 * It returns an ephemeral draft only. The user-facing Step 1 "Next" action
 * calls /produce/script-draft/commit, which is the only persistence point.
 */
import { createHash } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveAttachmentText } from "../lib/attachment-resolve";
import { contentLanguageInstruction, resolveContentLanguage } from "../lib/language";
import { robustStructuredGenerate, mapStructuredOutputError } from "../lib/robust-generate";
import { getContext } from "../lib/workspace-client";
import { reportProgress, throwIfCancelled } from "./engine";

const MAX_PLAN_SOURCE_CHARS = 70_000;
const MAX_SCRIPT_SOURCE_CHARS = 24_000;
const SCRIPT_CONCURRENCY = Math.max(1, Number(process.env.PRODUCE_SCRIPT_CONCURRENCY ?? 3));
const STORYBOARD_CONCURRENCY = Math.max(1, Number(process.env.PRODUCE_STORYBOARD_CONCURRENCY ?? 3));

const ProduceSourceFileSchema = z.object({
  name: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  path: z.string().optional(),
  textRef: z.string().optional(),
  chars: z.number().optional(),
  excerpt: z.string().optional(),
});

const ProduceSeedSchema = z.object({
  worldId: z.string().optional(),
  worldName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  episodeCount: z.number().optional(),
  runtimeMinutes: z.number().optional(),
  language: z.string().optional(),
  roleCount: z.number().optional(),
  sceneCount: z.number().optional(),
  propCount: z.number().optional(),
  sourceFile: ProduceSourceFileSchema.optional(),
  createdAt: z.number().optional(),
});

export const ProducePipelineInputSchema = z.object({
  projectId: z.string().min(1),
  worldId: z.string().optional(),
  seed: ProduceSeedSchema,
});

const EpisodePlanSchema = z.object({
  title: z.string().min(1).describe("Episode title (e.g. '第1集 荧惑守心')."),
  introduction: z
    .string()
    .min(1)
    .describe("1-3 sentence synopsis covering the dramatic beat, location, and turn/cliffhanger."),
  frontPrompt: z
    .string()
    .optional()
    .default("")
    .describe("Visual style prefix prepended to every shot in this episode (optional)."),
  behindPrompt: z
    .string()
    .optional()
    .default("")
    .describe("Visual style suffix appended to every shot in this episode (optional)."),
});

const AssetPlanSchema = z.object({
  name: z.string().min(1).describe("Short asset name (3-12 chars)."),
  description: z.string().min(1).describe("One-sentence narrative description."),
  prompt: z
    .string()
    .optional()
    .default("")
    .describe("Concise visual-generation prompt — appearance, lighting, mood. Not a story line."),
});

/**
 * Plan output shape. **All four top-level keys (`storySummary`,
 * `episodes`, `assets`, plus the optional metadata) must be returned
 * together** — Mastra's structured-output prompt-builder uses these
 * `.describe()` strings as the JSON-schema hint it sends the model;
 * without them qwen3.6-plus tends to emit only `{ episodes }` and skip
 * the rest, which previously dropped the whole pipeline at planStep.
 *
 * `storySummary` is now optional with a "" default + a normalize-time
 * fallback so a missing field doesn't kill the run; `episodes` stays
 * the only hard requirement (without it there's literally nothing to
 * produce).
 */
const PlanSchema = z.object({
  storySummary: z
    .string()
    .optional()
    .default("")
    .describe(
      "2-4 sentence overall premise of the season — the protagonist, the central conflict, the world. Not a per-episode plot."
    ),
  logline: z.string().optional().default("").describe("Single-sentence pitch (under 30 words)."),
  genre: z.string().optional().default("").describe("e.g. '古装权谋' / 'sci-fi noir'."),
  tone: z.string().optional().default("").describe("e.g. '冷峻克制' / 'romantic comedy'."),
  episodes: z
    .array(EpisodePlanSchema)
    .min(1)
    .describe("Ordered list of episodes; length should match the requested target episode count."),
  assets: z
    .object({
      characters: z
        .array(AssetPlanSchema)
        .optional()
        .default([])
        .describe("All speaking / on-screen characters drawn from the source."),
      scenes: z
        .array(AssetPlanSchema)
        .optional()
        .default([])
        .describe("Distinct shooting locations the episodes need."),
      props: z
        .array(AssetPlanSchema)
        .optional()
        .default([])
        .describe("Story-meaningful objects characters interact with."),
    })
    .optional()
    .default({ characters: [], scenes: [], props: [] })
    .describe("Production asset registry. Empty arrays are acceptable, but the object must exist."),
});

export const ScriptedEpisodeSchema = EpisodePlanSchema.extend({
  clientRefId: z.string().min(1),
  no: z.number().int().positive(),
  script: z.string().min(1),
});

const ProduceAssetDraftSchema = AssetPlanSchema.extend({
  clientRefId: z.string().min(1),
});

/**
 * Storyboarder LLM frequently emits `shot_no: 1` (number) and
 * `duration: "5s"` (string-with-unit) instead of the strict
 * string/number this schema requested. Mastra's structuredOutput
 * silently rejects on Zod parse and returns `response.object = undefined`
 * — and because storyboardStep has no fallback for that, the whole
 * pipeline tanks. Coerce-and-default both fields so the typical
 * variations land cleanly.
 */
const StoryboardRowSchema = z.object({
  shot_no: z.union([z.string(), z.number()]).transform((value) => String(value).trim() || "1"),
  scene: z.string().optional().default(""),
  description: z.string().min(1),
  image_prompt: z.string().optional().default(""),
  video_prompt: z.string().optional().default(""),
  movement: z.string().optional().default("固定镜头"),
  dialogue: z.string().optional().default(""),
  shot_size: z.string().optional().default("中景"),
  perspective: z.string().optional().default("平视"),
  duration: z
    .union([z.number(), z.string()])
    .optional()
    .default(5)
    .transform((value) => {
      if (typeof value === "number") return Number.isFinite(value) ? value : 5;
      const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
      return Number.isFinite(parsed) ? parsed : 5;
    }),
});

const EpisodeWithStoryboardSchema = ScriptedEpisodeSchema.extend({
  storyboardRows: z.array(StoryboardRowSchema).min(1),
});

export const ProducePipelineOutputSchema = z.object({
  projectId: z.string(),
  worldId: z.string().optional(),
  title: z.string(),
  sourceName: z.string().optional(),
  sourceChars: z.number().optional(),
  language: z.string().optional(),
  storySummary: z.string(),
  logline: z.string().optional(),
  genre: z.string().optional(),
  tone: z.string().optional(),
  episodes: z.array(EpisodeWithStoryboardSchema).min(1),
  assets: z.object({
    characters: z.array(ProduceAssetDraftSchema),
    scenes: z.array(ProduceAssetDraftSchema),
    props: z.array(ProduceAssetDraftSchema),
  }),
  generatedAt: z.number(),
});

type ProducePipelineInput = z.infer<typeof ProducePipelineInputSchema>;
type ProducePipelineOutput = z.infer<typeof ProducePipelineOutputSchema>;
type Plan = z.infer<typeof PlanSchema>;
type StoryboardRow = z.infer<typeof StoryboardRowSchema>;

type ResolvedInput = ProducePipelineInput & {
  sourceText: string;
  sourceExcerpt: string;
  targetEpisodeCount: number;
  shotsPerEpisode: number;
  languageLabel: string;
};

type PlannedInput = ResolvedInput & {
  plan: Plan;
};

type ScriptedInput = PlannedInput & {
  episodes: z.infer<typeof ScriptedEpisodeSchema>[];
};

type FinalizedInput = ScriptedInput & {
  finalizedAssets: ProducePipelineOutput["assets"];
};

export const ResolvedInputSchema = ProducePipelineInputSchema.extend({
  sourceText: z.string().min(1),
  sourceExcerpt: z.string().min(1),
  targetEpisodeCount: z.number().int().positive(),
  shotsPerEpisode: z.number().int().positive(),
  languageLabel: z.string().min(1),
});

export const PlannedInputSchema = ResolvedInputSchema.extend({
  plan: PlanSchema,
});

export const ScriptedInputSchema = PlannedInputSchema.extend({
  episodes: z.array(ScriptedEpisodeSchema).min(1),
});

const FinalizedInputSchema = ScriptedInputSchema.extend({
  finalizedAssets: ProducePipelineOutputSchema.shape.assets,
});

export const resolveSourceStep = createStep({
  id: "resolve_source",
  inputSchema: ProducePipelineInputSchema,
  outputSchema: ResolvedInputSchema,
  execute: async ({ inputData, requestContext }) => {
    // We deliberately read individual keys off requestContext here
    // instead of calling `getContext`. The wider `getContext` helper
    // requires a non-empty cookie for Java calls — but resolve_source
    // never talks to Java (it only pulls cached source text from
    // Redis), so demanding a cookie blocked legitimate runs whenever
    // the browser hadn't established a session yet.
    const seed = inputData.seed;
    const sourceRef = seed.sourceFile?.textRef?.trim();
    let sourceText = "";
    if (sourceRef) {
      sourceText = await resolveAttachmentText(sourceRef, { projectId: inputData.projectId });
    }
    if (!sourceText.trim() && seed.sourceFile?.excerpt) {
      sourceText = seed.sourceFile.excerpt;
    }
    if (!sourceText.trim() && seed.description) {
      sourceText = seed.description;
    }
    sourceText = sourceText.trim();
    if (!sourceText) {
      throw new Error("缺少可分析的剧本文本。请重新上传剧本文件后再试。");
    }

    const shotsPerEpisodeRaw = requestContext?.get("shotsPerEpisode");
    const dialogLanguageRaw = requestContext?.get("dialogLanguage");
    const shotsPerEpisodeNumber =
      typeof shotsPerEpisodeRaw === "number" ? shotsPerEpisodeRaw : undefined;
    const dialogLanguage = typeof dialogLanguageRaw === "string" ? dialogLanguageRaw : undefined;

    const targetEpisodeCount = clampInt(seed.episodeCount, 1, 30, 10);
    const shotsPerEpisode = clampInt(shotsPerEpisodeNumber, 4, 24, 8);
    const languageLabel = seed.language?.trim() || dialogLanguageLabel(dialogLanguage);
    const runId = requestContext?.get("runId") as string | undefined;
    if (runId) {
      await reportProgress(runId, {
        stepId: "produce.resolve_source",
        current: 1,
        total: 4,
        label: "读取剧本素材",
      });
    }

    return {
      ...inputData,
      worldId: inputData.worldId || seed.worldId,
      sourceText,
      sourceExcerpt: sourceText.slice(0, MAX_SCRIPT_SOURCE_CHARS),
      targetEpisodeCount,
      shotsPerEpisode,
      languageLabel,
    };
  },
});

export const planStep = createStep({
  id: "plan_story",
  inputSchema: ResolvedInputSchema,
  outputSchema: PlannedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requireRunId(requestContext);
    await throwIfCancelled(runId);
    await reportProgress(runId, {
      stepId: "produce.plan_story",
      current: 1,
      total: 4,
      label: "规划剧集、核心资产和叙事结构",
    });

    const planner = mastra?.getAgent("episodePlanner") ?? mastra?.getAgent("briefAnalyzer");
    if (!planner) throw new Error("produce pipeline: planner agent not registered");

    const { object } = await robustStructuredGenerate<Plan>({
      agent: planner,
      schema: PlanSchema as unknown as z.ZodType<Plan>,
      tag: `produce-plan-${runId}`,
      prompt: buildPlanPrompt(inputData),
      // Episodes is the only structurally-required output — everything
      // else has a sensible default in normalizePlan. Demanding a
      // non-empty `storySummary` here used to nuke the whole run when
      // qwen3.6-plus skipped that field.
      isEmpty: (obj) => !obj?.episodes?.length,
    });

    return {
      ...inputData,
      plan: normalizePlan(object, inputData.targetEpisodeCount),
    };
  },
});

export const scriptStep = createStep({
  id: "write_scripts",
  inputSchema: PlannedInputSchema,
  outputSchema: ScriptedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requireRunId(requestContext);
    await throwIfCancelled(runId);
    const scriptwriter = mastra?.getAgent("scriptwriter");
    if (!scriptwriter) throw new Error("produce pipeline: scriptwriter agent not registered");

    const planEpisodes = inputData.plan.episodes;
    const total = planEpisodes.length;
    const episodes: Array<z.infer<typeof ScriptedEpisodeSchema> | null> = new Array(total).fill(
      null
    );
    const errors: string[] = [];
    let completed = 0;
    let cursor = 0;

    await reportProgress(runId, {
      stepId: "produce.write_scripts",
      current: 0,
      total,
      label: `撰写剧集剧本 0/${total}`,
    });

    const runOne = async (index: number) => {
      await throwIfCancelled(runId);
      const episode = planEpisodes[index];
      try {
        const { object } = await robustStructuredGenerate<{ content: string }>({
          agent: scriptwriter,
          schema: z.object({ content: z.string().min(80) }),
          tag: `produce-script-${runId}-ep${index + 1}`,
          prompt: buildScriptPrompt(inputData, episode, index),
          isEmpty: (obj) => !obj?.content?.trim() || obj.content.trim().length < 80,
        });
        episodes[index] = {
          ...episode,
          no: index + 1,
          clientRefId: buildClientRef("episode", index, episode.title),
          script: object.content.trim(),
        };
      } catch (err) {
        const reason = mapStructuredOutputError(err, `第 ${index + 1} 集剧本生成`);
        errors.push(`${episode.title}: ${reason}`);
      } finally {
        completed += 1;
        await reportProgress(runId, {
          stepId: "produce.write_scripts",
          current: completed,
          total,
          label: `撰写剧集剧本 ${completed}/${total}`,
        });
      }
    };

    const workers = Array.from({ length: Math.min(SCRIPT_CONCURRENCY, total) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= total) return;
        await runOne(index);
      }
    });
    await Promise.all(workers);

    const ok = episodes.filter((ep): ep is z.infer<typeof ScriptedEpisodeSchema> => ep !== null);
    if (ok.length !== total) {
      throw new Error(
        `剧本生成未完成：${ok.length}/${total} 成功。${errors.slice(0, 3).join("；")}`
      );
    }

    return { ...inputData, episodes: ok };
  },
});

const finalizeAssetsStep = createStep({
  id: "finalize_assets",
  inputSchema: ScriptedInputSchema,
  outputSchema: FinalizedInputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requireRunId(requestContext);
    await throwIfCancelled(runId);
    await reportProgress(runId, {
      stepId: "produce.finalize_assets",
      current: 3,
      total: 4,
      label: "整理角色、场景和道具资产",
    });

    const artDirector = mastra?.getAgent("artDirector");
    if (!artDirector) {
      return { ...inputData, finalizedAssets: assetsFromPlan(inputData.plan) };
    }

    try {
      const { object } = await robustStructuredGenerate<Plan["assets"]>({
        agent: artDirector,
        schema: PlanSchema.shape.assets as unknown as z.ZodType<Plan["assets"]>,
        tag: `produce-assets-${runId}`,
        prompt: buildAssetsPrompt(inputData),
        isEmpty: (obj) =>
          !obj ||
          ((obj.characters?.length ?? 0) === 0 &&
            (obj.scenes?.length ?? 0) === 0 &&
            (obj.props?.length ?? 0) === 0),
      });
      return {
        ...inputData,
        finalizedAssets: normalizeAssets(object, inputData.plan),
      };
    } catch (err) {
      console.warn(
        `[produce] asset finalization fallback runId=${runId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { ...inputData, finalizedAssets: assetsFromPlan(inputData.plan) };
    }
  },
});

const storyboardStep = createStep({
  id: "generate_storyboards",
  inputSchema: FinalizedInputSchema,
  outputSchema: ProducePipelineOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requireRunId(requestContext);
    await throwIfCancelled(runId);
    const storyboarder = mastra?.getAgent("storyboarder");
    if (!storyboarder) throw new Error("produce pipeline: storyboarder agent not registered");

    const total = inputData.episodes.length;
    const outputEpisodes: Array<z.infer<typeof EpisodeWithStoryboardSchema> | null> = new Array(
      total
    ).fill(null);
    const errors: string[] = [];
    let completed = 0;
    let cursor = 0;

    await reportProgress(runId, {
      stepId: "produce.generate_storyboards",
      current: 0,
      total,
      label: `生成分镜 ${completed}/${total}`,
    });

    const runOne = async (index: number) => {
      await throwIfCancelled(runId);
      const episode = inputData.episodes[index];
      try {
        const { object } = await robustStructuredGenerate<{ rows: StoryboardRow[] }>({
          agent: storyboarder,
          schema: z.object({ rows: z.array(StoryboardRowSchema).min(3) }) as unknown as z.ZodType<{
            rows: StoryboardRow[];
          }>,
          tag: `produce-storyboard-${runId}-ep${index + 1}`,
          prompt: buildStoryboardPrompt(inputData, episode),
          isEmpty: (obj) => (obj?.rows?.filter((row) => row.description?.trim()).length ?? 0) < 3,
        });
        const rows = object.rows
          .filter((row) => row.description?.trim())
          .slice(0, Math.max(3, inputData.shotsPerEpisode + 6))
          .map((row, rowIndex) => ({
            ...row,
            shot_no: String(rowIndex + 1),
            image_prompt: row.image_prompt?.trim() || row.description,
            video_prompt: row.video_prompt?.trim() || row.description,
          }));
        outputEpisodes[index] = { ...episode, storyboardRows: rows };
      } catch (err) {
        const reason = mapStructuredOutputError(err, `第 ${index + 1} 集分镜生成`);
        errors.push(`${episode.title}: ${reason}`);
      } finally {
        completed += 1;
        await reportProgress(runId, {
          stepId: "produce.generate_storyboards",
          current: completed,
          total,
          label: `生成分镜 ${completed}/${total}`,
        });
      }
    };

    const workers = Array.from({ length: Math.min(STORYBOARD_CONCURRENCY, total) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= total) return;
        await runOne(index);
      }
    });
    await Promise.all(workers);

    const episodes = outputEpisodes.filter(
      (ep): ep is z.infer<typeof EpisodeWithStoryboardSchema> => ep !== null
    );
    // Allow partial completes — at least one episode worth of
    // storyboard is enough to give the user a draft to review. Hard-
    // failing the whole pipeline because qwen3.6-plus burped on a
    // single episode wastes the work that already succeeded.
    if (episodes.length === 0) {
      throw new Error(
        `分镜生成未完成：${episodes.length}/${total} 成功。${errors.slice(0, 3).join("；")}`
      );
    }
    if (errors.length > 0) {
      console.warn(
        `[produce] storyboard partial: ${episodes.length}/${total} ok; failures: ${errors.join("; ")}`
      );
    }

    await reportProgress(runId, {
      stepId: "produce.done",
      current: 4,
      total: 4,
      label: "临时草稿已生成，等待确认入库",
    });

    return {
      projectId: inputData.projectId,
      worldId: inputData.worldId,
      title: inputData.seed.worldName?.trim() || "Untitled project",
      sourceName: inputData.seed.sourceFile?.name,
      sourceChars: inputData.seed.sourceFile?.chars ?? inputData.sourceText.length,
      language: inputData.seed.language,
      storySummary: inputData.plan.storySummary,
      logline: inputData.plan.logline,
      genre: inputData.plan.genre,
      tone: inputData.plan.tone,
      episodes,
      assets: inputData.finalizedAssets,
      generatedAt: Date.now(),
    };
  },
});

export const produceScriptPipelineWorkflow = createWorkflow({
  id: "produce_script_pipeline",
  description:
    "Produce mode: source script → episodes → scripts → assets → storyboards. Returns an ephemeral draft only; no Java writes.",
  inputSchema: ProducePipelineInputSchema,
  outputSchema: ProducePipelineOutputSchema,
})
  .then(resolveSourceStep)
  .then(planStep)
  .then(scriptStep)
  .then(finalizeAssetsStep)
  .then(storyboardStep)
  .commit();

function requireRunId(requestContext: { get(key: string): unknown } | undefined): string {
  const runId = requestContext?.get("runId");
  if (typeof runId !== "string" || !runId) throw new Error("runId missing");
  return runId;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[Source clipped at ${max} chars]`;
}

function buildClientRef(prefix: string, index: number, label: string): string {
  const hash = createHash("sha1").update(label).digest("hex").slice(0, 8);
  return `${prefix}_${index + 1}_${hash}`;
}

function dialogLanguageLabel(code: string | undefined): string {
  switch (code) {
    case "zh-CN":
      return "Chinese";
    case "zh-HK":
      return "Traditional Chinese";
    case "en-US":
      return "English";
    default:
      return code || "Chinese";
  }
}

function buildPlanPrompt(input: ResolvedInput): string {
  const seed = input.seed;
  return [
    "You are planning a production pipeline from an uploaded novel or screenplay.",
    "Create a complete but practical short-drama adaptation plan. This is not a chat answer; return only JSON.",
    "",
    `Project title: ${seed.worldName || "(untitled)"}`,
    seed.description ? `Existing description: ${seed.description}` : "",
    seed.tags?.length ? `Tags: ${seed.tags.join(", ")}` : "",
    `Target episode count: ${input.targetEpisodeCount}`,
    `Primary content language: ${input.languageLabel}`,
    "",
    // Explicit shape — qwen3.6-plus has been observed silently dropping
    // `storySummary` and `assets` when only the schema describes them
    // (it complies with `episodes` because `EpisodePlanSchema` is the
    // most-detailed sub-schema). Listing the keys here in plain prose
    // forces the model to fill them.
    "Output JSON object with these top-level keys, ALL REQUIRED:",
    "  • storySummary  (2-4 sentences — overall season premise)",
    "  • logline       (one-sentence pitch, optional)",
    "  • genre / tone  (short labels, optional)",
    `  • episodes      (array of exactly ${input.targetEpisodeCount} items, each with title + introduction)`,
    "  • assets        (object with characters[], scenes[], props[]; each entry: { name, description, prompt })",
    "",
    "Requirements:",
    `- Return exactly ${input.targetEpisodeCount} episodes unless the source obviously cannot support it.`,
    "- Each episode needs a clear dramatic beat, visual setting, and cliffhanger/turn.",
    "- Build the asset registry as reusable production assets: characters, scenes/locations, props.",
    "- Asset prompts should be concise visual-generation prompts, not story summaries.",
    "- Empty arrays (e.g. no props) are allowed, but the `assets` object itself must be present.",
    `- All titles, summaries, descriptions, scripts, and storyboard text must use ${input.languageLabel}.`,
    contentLanguageInstruction(resolveContentLanguage(input.seed.language)),
    "",
    "Source text:",
    clip(input.sourceText, MAX_PLAN_SOURCE_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizePlan(plan: Plan, targetEpisodeCount: number): Plan {
  const episodes = plan.episodes.slice(0, targetEpisodeCount).map((ep, index) => ({
    title: ep.title.trim() || `第 ${index + 1} 集`,
    introduction: ep.introduction.trim(),
    frontPrompt: ep.frontPrompt?.trim() || ep.introduction.trim(),
    behindPrompt: ep.behindPrompt?.trim() || ep.introduction.trim(),
  }));
  // If the model omitted `storySummary`, derive a stub from the first
  // few episode introductions so downstream steps (script, storyboard,
  // commit recap) still have a non-empty premise to anchor on. Cheaper
  // than a second LLM call and the user can rewrite it post-commit.
  const storySummary =
    plan.storySummary?.trim() ||
    episodes
      .slice(0, 3)
      .map((ep) => ep.introduction)
      .filter(Boolean)
      .join(" ")
      .slice(0, 400);
  const assets = plan.assets ?? { characters: [], scenes: [], props: [] };
  return {
    storySummary,
    logline: plan.logline?.trim() || "",
    genre: plan.genre?.trim() || "",
    tone: plan.tone?.trim() || "",
    episodes,
    assets: {
      characters: dedupeAssets(assets.characters ?? []),
      scenes: dedupeAssets(assets.scenes ?? []),
      props: dedupeAssets(assets.props ?? []),
    },
  };
}

function dedupeAssets(items: z.infer<typeof AssetPlanSchema>[]): z.infer<typeof AssetPlanSchema>[] {
  const seen = new Set<string>();
  const out: z.infer<typeof AssetPlanSchema>[] = [];
  for (const item of items) {
    const name = item.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      description: item.description.trim(),
      prompt: item.prompt?.trim() || item.description.trim(),
    });
  }
  return out;
}

function buildScriptPrompt(
  input: PlannedInput,
  episode: z.infer<typeof EpisodePlanSchema>,
  index: number
): string {
  return [
    `Write the full shootable script for episode ${index + 1}/${input.plan.episodes.length}.`,
    `Content language: ${input.languageLabel}.`,
    "",
    "Whole story summary:",
    input.plan.storySummary,
    "",
    "Episode:",
    `Title: ${episode.title}`,
    `Outline: ${episode.introduction}`,
    "",
    "Known assets:",
    buildAssetList(input.plan.assets),
    "",
    "Format requirements:",
    "- Use time blocks, visual direction, dialogue/narration, sound or ambience cues.",
    "- Keep the episode compact and shootable for a short-drama/video pipeline.",
    "- Preserve the source's genre, tone, and key plot logic.",
    "- No Markdown fences or commentary.",
    contentLanguageInstruction(resolveContentLanguage(input.seed.language)),
    "",
    "Source excerpt for fidelity:",
    clip(input.sourceExcerpt, MAX_SCRIPT_SOURCE_CHARS),
    "",
    'Return JSON: {"content":"...script text with real newlines..."}',
  ].join("\n");
}

function buildAssetList(assets: Plan["assets"]): string {
  const section = (label: string, items: z.infer<typeof AssetPlanSchema>[]) =>
    [`${label}:`, ...items.slice(0, 30).map((item) => `- ${item.name}: ${item.description}`)].join(
      "\n"
    );
  return [
    section("Characters", assets.characters),
    section("Scenes", assets.scenes),
    section("Props", assets.props),
  ].join("\n\n");
}

function buildAssetsPrompt(input: ScriptedInput): string {
  const scriptsBrief = input.episodes
    .map((ep) => `EP${ep.no} ${ep.title}\n${clip(ep.script, 1800)}`)
    .join("\n\n");
  return [
    "Finalize the reusable visual asset registry for this production.",
    `Content language for names/descriptions: ${input.languageLabel}. Prompts can be bilingual if useful, but should be image-model friendly.`,
    "",
    "Initial asset registry:",
    buildAssetList(input.plan.assets),
    "",
    "Episode scripts:",
    scriptsBrief,
    "",
    "Return only the assets that should become reusable production assets.",
    "Each prompt must describe visual identity clearly enough for image generation.",
  ].join("\n");
}

function normalizeAssets(assets: Plan["assets"], fallback: Plan): ProducePipelineOutput["assets"] {
  const withRefs = (
    prefix: "character" | "scene" | "prop",
    items: z.infer<typeof AssetPlanSchema>[],
    fallbackItems: z.infer<typeof AssetPlanSchema>[]
  ): z.infer<typeof ProduceAssetDraftSchema>[] => {
    const normalized = dedupeAssets(items.length ? items : fallbackItems);
    return normalized.map((item, index) => ({
      ...item,
      clientRefId: buildClientRef(prefix, index, item.name),
    }));
  };
  return {
    characters: withRefs("character", assets.characters ?? [], fallback.assets.characters),
    scenes: withRefs("scene", assets.scenes ?? [], fallback.assets.scenes),
    props: withRefs("prop", assets.props ?? [], fallback.assets.props),
  };
}

function assetsFromPlan(plan: Plan): ProducePipelineOutput["assets"] {
  return normalizeAssets(plan.assets, plan);
}

function buildStoryboardPrompt(
  input: FinalizedInput,
  episode: z.infer<typeof ScriptedEpisodeSchema>
): string {
  const sceneNames = input.finalizedAssets.scenes.map((scene) => scene.name).join("、");
  return [
    `Create storyboard rows for episode ${episode.no}: ${episode.title}.`,
    `Target rows: around ${input.shotsPerEpisode}. Content language: ${input.languageLabel}.`,
    "",
    "Use scene names from this list when possible:",
    sceneNames || "(no predefined scenes)",
    "",
    "Characters and props:",
    buildAssetList({
      characters: input.finalizedAssets.characters,
      scenes: input.finalizedAssets.scenes,
      props: input.finalizedAssets.props,
    }),
    "",
    "Episode script:",
    episode.script,
    "",
    "Rows must be directly usable by a video/storyboard editor.",
    "Return JSON only: { rows: [{ shot_no, scene, description, image_prompt, video_prompt, movement, dialogue, shot_size, perspective, duration }] }",
  ].join("\n");
}
