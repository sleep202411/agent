/**
 * Produce Step 2 — extract characters / scenes / props from the
 * project's already-committed episodes.
 *
 * Runs after Step 1 has written the episode list + scripts to Java.
 * The workflow is read-only against Java in `generate` (lists + filters
 * by name); the actual inserts happen in the matching `step2/commit`
 * route, which reuses the existing batch_create_* helpers so the wire
 * shape matches every other write path.
 *
 * LLM input uses the per-episode `introduction` only (not the full
 * scripts) — by design. The synopsis carries enough signal to pick out
 * recurring characters / scenes / props without flooding the model
 * with prose token costs.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { contentLanguageInstruction, resolveContentLanguage } from "../lib/language";
import { robustStructuredGenerate, mapStructuredOutputError } from "../lib/robust-generate";
import { getContext, javaRequest, type StoryosContext } from "../lib/workspace-client";
import { reportProgress, throwIfCancelled } from "./engine";

const MAX_INTRO_CHARS_PER_EP = 800;

// ─── Public schemas ────────────────────────────────────────────────────

export const Step2InputSchema = z.object({
  projectId: z.string().min(1),
  worldId: z.string().min(1),
});

const AssetItemSchema = z.object({
  name: z.string().min(1).describe("Asset name (3-12 chars / 1-3 English words)."),
  description: z.string().min(1).describe("One-sentence narrative role description."),
  prompt: z
    .string()
    .min(1)
    .describe("Visual generation prompt — appearance / look-and-feel tokens. Not a story line."),
});

export const Step2OutputSchema = z.object({
  projectId: z.string(),
  worldId: z.string(),
  characters: z.array(AssetItemSchema),
  scenes: z.array(AssetItemSchema),
  props: z.array(AssetItemSchema),
  existingCounts: z.object({
    characters: z.number(),
    scenes: z.number(),
    props: z.number(),
  }),
  generatedAt: z.number(),
});

export type Step2Output = z.infer<typeof Step2OutputSchema>;

// ─── Internal step schemas ─────────────────────────────────────────────

const LoadedContextSchema = Step2InputSchema.extend({
  episodes: z.array(
    z.object({
      title: z.string(),
      introduction: z.string(),
    })
  ),
  existingNames: z.object({
    characters: z.array(z.string()),
    scenes: z.array(z.string()),
    props: z.array(z.string()),
  }),
});

type LoadedContext = z.infer<typeof LoadedContextSchema>;

interface JavaEpisode {
  id?: string | number;
  title?: string;
  introduction?: string;
  sort?: number;
}

interface JavaAssetRow {
  id?: string | number;
  name?: string;
}

const ExtractionSchema = z.object({
  characters: z.array(AssetItemSchema).max(20),
  scenes: z.array(AssetItemSchema).max(20),
  props: z.array(AssetItemSchema).max(20),
});

type Extraction = z.infer<typeof ExtractionSchema>;

// ─── Steps ─────────────────────────────────────────────────────────────

const loadContextStep = createStep({
  id: "load_context",
  inputSchema: Step2InputSchema,
  outputSchema: LoadedContextSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = requestContext?.get("runId") as string | undefined;
    if (runId) {
      await reportProgress(runId, {
        stepId: "produce.step2.load_context",
        current: 1,
        total: 3,
        label: "读取剧集与已有资产",
      });
    }

    // Episodes list — `productId` is Java's name for projectId on this
    // endpoint (legacy; mirrors what the rest of the codebase passes).
    const episodesPage = await javaRequest<{ list?: JavaEpisode[] }>(
      ctx,
      "/api/user/world/list/episode",
      { data: { productId: inputData.projectId, page: 1, pageSize: 200 } }
    );
    const episodes = (episodesPage.list ?? [])
      .slice()
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((ep) => ({
        title: String(ep.title ?? "").trim(),
        introduction: String(ep.introduction ?? "")
          .trim()
          .slice(0, MAX_INTRO_CHARS_PER_EP),
      }))
      .filter((ep) => ep.introduction.length > 0);
    if (episodes.length === 0) {
      throw new Error(
        "No episodes with introductions found — run Step 1 first to generate episode breakdowns."
      );
    }

    // Existing assets — name only is enough for dedup. Read all three
    // in parallel; failures are non-fatal (we just skip dedup for the
    // affected category).
    const [roles, scenes, props] = await Promise.all(
      (
        [
          ["worldrole", "characters"],
          ["worldscene", "scenes"],
          ["worldprop", "props"],
        ] as const
      ).map(async ([endpoint]) => {
        try {
          const page = await javaRequest<{ list?: JavaAssetRow[] }>(
            ctx,
            `/api/user/world/list/${endpoint}`,
            { data: { worldId: inputData.worldId, page: 1, pageSize: 500 } }
          );
          return (page.list ?? []).map((row) => String(row.name ?? "").trim()).filter(Boolean);
        } catch (err) {
          console.warn(
            `[produce/step2] failed to list ${endpoint}: ${err instanceof Error ? err.message : err}`
          );
          return [] as string[];
        }
      })
    );

    return {
      ...inputData,
      episodes,
      existingNames: { characters: roles, scenes, props },
    };
  },
});

const extractAssetsStep = createStep({
  id: "extract_assets",
  inputSchema: LoadedContextSchema,
  outputSchema: Step2OutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (runId) await throwIfCancelled(runId);

    const planner = mastra?.getAgent("episodePlanner") ?? mastra?.getAgent("briefAnalyzer");
    if (!planner) {
      throw new Error("produce/step2: episodePlanner agent not registered");
    }

    if (runId) {
      await reportProgress(runId, {
        stepId: "produce.step2.extract_assets",
        current: 2,
        total: 3,
        label: "抽取角色 / 场景 / 道具",
      });
    }

    const llmStart = Date.now();
    console.info(
      `[produce/step2] extract_assets LLM start runId=${runId ?? "?"} episodes=${inputData.episodes.length} existing=chars:${inputData.existingNames.characters.length}/scenes:${inputData.existingNames.scenes.length}/props:${inputData.existingNames.props.length}`
    );
    let extraction: Extraction;
    try {
      const result = await robustStructuredGenerate<Extraction>({
        agent: planner,
        schema: ExtractionSchema as unknown as z.ZodType<Extraction>,
        tag: `produce-step2-${runId ?? "x"}`,
        prompt: buildExtractionPrompt(inputData),
        isEmpty: (obj) =>
          (obj?.characters?.length ?? 0) +
            (obj?.scenes?.length ?? 0) +
            (obj?.props?.length ?? 0) ===
          0,
      });
      extraction = result.object;
    } catch (err) {
      console.error(
        `[produce/step2] extract_assets LLM failed runId=${runId ?? "?"} after=${Date.now() - llmStart}ms`,
        err
      );
      throw new Error(mapStructuredOutputError(err, "Step 2 资产抽取"));
    }
    console.info(
      `[produce/step2] extract_assets LLM done runId=${runId ?? "?"} took=${Date.now() - llmStart}ms raw=chars:${extraction.characters?.length ?? 0}/scenes:${extraction.scenes?.length ?? 0}/props:${extraction.props?.length ?? 0}`
    );

    if (runId) await throwIfCancelled(runId);

    // Dedup by name against existing Java rows. Case-insensitive +
    // trimmed match; we keep the LLM's casing for new items so the UI
    // doesn't mutate them post-review.
    const skip = (existing: string[]) => {
      const set = new Set(existing.map((n) => n.toLowerCase().trim()));
      return (item: { name: string }) => !set.has(item.name.toLowerCase().trim());
    };
    const characters = (extraction.characters ?? []).filter(
      skip(inputData.existingNames.characters)
    );
    const scenes = (extraction.scenes ?? []).filter(skip(inputData.existingNames.scenes));
    const props = (extraction.props ?? []).filter(skip(inputData.existingNames.props));

    if (runId) {
      await reportProgress(runId, {
        stepId: "produce.step2.done",
        current: 3,
        total: 3,
        label: `资产草稿就绪：${characters.length} 角色 · ${scenes.length} 场景 · ${props.length} 道具`,
      });
    }

    return {
      projectId: inputData.projectId,
      worldId: inputData.worldId,
      characters,
      scenes,
      props,
      existingCounts: {
        characters: inputData.existingNames.characters.length,
        scenes: inputData.existingNames.scenes.length,
        props: inputData.existingNames.props.length,
      },
      generatedAt: Date.now(),
    };
  },
});

export const produceStep2AssetsWorkflow = createWorkflow({
  id: "produce_step2_assets",
  description:
    "Step 2 of the produce pipeline: read committed episodes + existing assets, extract a deduplicated set of characters / scenes / props from the per-episode introductions. Returns an ephemeral draft only — the matching commit route writes the new rows to Java.",
  inputSchema: Step2InputSchema,
  outputSchema: Step2OutputSchema,
})
  .then(loadContextStep)
  .then(extractAssetsStep)
  .commit();

// ─── Prompt ────────────────────────────────────────────────────────────

function buildExtractionPrompt(input: LoadedContext): string {
  const language = resolveContentLanguage(undefined);
  const langClause = contentLanguageInstruction(language);

  const episodeBlock = input.episodes
    .map((ep, i) => `第${i + 1}集「${ep.title}」\n${ep.introduction}`)
    .join("\n\n");

  const existingBlock = (() => {
    const parts: string[] = [];
    if (input.existingNames.characters.length > 0) {
      parts.push(`- 角色：${input.existingNames.characters.join(" / ")}`);
    }
    if (input.existingNames.scenes.length > 0) {
      parts.push(`- 场景：${input.existingNames.scenes.join(" / ")}`);
    }
    if (input.existingNames.props.length > 0) {
      parts.push(`- 道具：${input.existingNames.props.join(" / ")}`);
    }
    return parts.length > 0 ? `\n\n[已有资产 — 不要重复输出]\n${parts.join("\n")}` : "";
  })();

  return [
    `${langClause} 你是 Production Pipeline Step 2 — 资产抽取。`,
    "",
    "[任务]",
    "从下面的剧集简介里抽取这部短剧需要的关键资产，分三类：",
    "  - characters：在剧情里反复出现 / 推动情节的角色（含主角、反派、关键配角）",
    "  - scenes：戏份较多的场景（地点、空间），不是一次性闪回",
    "  - props：承担剧情功能的道具（信物、关键证物、武器、信件等），不是日常用品",
    "",
    "[每条资产填写以下结构]",
    "  - name: 简洁的中文名（3-12 字）",
    "  - description: 一句话说明它在剧情里的作用",
    "  - prompt: 一句视觉生成 token（外观 / 材质 / 氛围），不要写情节",
    "",
    "[硬性约束]",
    "  - 三类各最多 8 项，少于 8 没关系",
    "  - 不要重复已有资产里出现过的名字（见下）",
    "  - 不要把一次性人物 / 一次性场景 / 一次性物件列进来",
    "",
    "[剧集简介]",
    episodeBlock,
    existingBlock,
    "",
    "[Response format]",
    "Return a JSON object that matches the structuredOutput schema exactly: { characters, scenes, props } each as an array of {name, description, prompt}.",
  ].join("\n");
}

// Re-exported so route handlers can build a `getContext`-compatible
// shape without re-importing from workspace-client themselves.
export type { StoryosContext };
