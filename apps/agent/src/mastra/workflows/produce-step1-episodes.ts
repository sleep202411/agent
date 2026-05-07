/**
 * Produce Step 1 — episode breakdown + per-episode script.
 *
 * Slimmer split-out of `produce_script_pipeline`'s first half. Returns
 * an ephemeral draft (no Java writes); /produce/step1/commit is the
 * sole persistence point. Stops at scripts — assets and storyboards
 * are owned by Step 2 / Step 3 workflows respectively, each with its
 * own generate / commit cycle.
 *
 * Why split:
 *   - 30-min single sync call → three 5–10 min calls; smaller blast
 *     radius for LLM / network hiccups.
 *   - User reviews + commits each step before moving on, so partial
 *     work survives any failure (committed in Java).
 *   - Re-running step N never wastes step N-1's output.
 *
 * Reuses the existing `resolveSourceStep` / `planStep` / `scriptStep`
 * from `produce-script-pipeline.ts` to keep parity with the original
 * pipeline's prompt + LLM logic. The trailing `finalizeStep1Step`
 * just trims the carried-along `inputData` down to the wire shape
 * the route handler emits.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  ProducePipelineInputSchema,
  ScriptedEpisodeSchema,
  ScriptedInputSchema,
  resolveSourceStep,
  planStep,
  scriptStep,
} from "./produce-script-pipeline";

/**
 * Wire shape returned to the client by /produce/step1/generate.
 * Limited to what the user reviews on the script page — no asset
 * lists, no storyboard rows.
 */
export const Step1OutputSchema = z.object({
  projectId: z.string(),
  worldId: z.string().optional(),
  title: z.string(),
  storySummary: z.string(),
  logline: z.string().optional(),
  genre: z.string().optional(),
  tone: z.string().optional(),
  language: z.string().optional(),
  sourceName: z.string().optional(),
  sourceChars: z.number().optional(),
  episodes: z.array(ScriptedEpisodeSchema),
  generatedAt: z.number(),
});

export type Step1Output = z.infer<typeof Step1OutputSchema>;

const finalizeStep1Step = createStep({
  id: "finalize_step1",
  inputSchema: ScriptedInputSchema,
  outputSchema: Step1OutputSchema,
  execute: async ({ inputData }) => ({
    projectId: inputData.projectId,
    worldId: inputData.worldId || inputData.seed.worldId,
    title: inputData.seed.worldName?.trim() || "Untitled project",
    sourceName: inputData.seed.sourceFile?.name,
    sourceChars: inputData.seed.sourceFile?.chars ?? inputData.sourceText.length,
    language: inputData.seed.language,
    storySummary: inputData.plan.storySummary,
    logline: inputData.plan.logline,
    genre: inputData.plan.genre,
    tone: inputData.plan.tone,
    episodes: inputData.episodes,
    generatedAt: Date.now(),
  }),
});

export const produceStep1EpisodesWorkflow = createWorkflow({
  id: "produce_step1_episodes",
  description:
    "Step 1 of the produce pipeline: break source material into N episodes and write each episode's script. Returns an ephemeral draft only — /produce/step1/commit is the sole persistence point.",
  inputSchema: ProducePipelineInputSchema,
  outputSchema: Step1OutputSchema,
})
  .then(resolveSourceStep)
  .then(planStep)
  .then(scriptStep)
  .then(finalizeStep1Step)
  .commit();
