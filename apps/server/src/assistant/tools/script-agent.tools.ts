import { Logger } from '@nestjs/common';
import { tool, generateObject, generateText } from 'ai';
import { z } from 'zod/v4';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { AssistantToolContext } from './types';
import { buildMutationResult, mutationResultSchema } from './shared';
import type { AiService } from '../../ai/ai.service';
import type { ScriptAgentService } from '../../pipeline/script-agent.service';
import { extractTextFromUrl } from '../../pipeline/engine/file-extract';
import { withRetry, runWithConcurrency } from '../../pipeline/engine/retry';
import type { AnalyzeResult } from '../../pipeline/pipelines/novel-to-storyboard/schemas';
import { analyzeStep } from '../../pipeline/pipelines/novel-to-storyboard/analyze.step';

const logger = new Logger('ScriptAgentTools');
const randomId = () => Math.random().toString(36).slice(2, 10);

/**
 * Convert plain text with \n to HTML paragraphs for Tiptap editor.
 */
function textToHtml(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n');
}

// ── Shared helpers ──

async function resolveText(ctx: AssistantToolContext): Promise<string> {
  // Try plain text from attachment excerpt
  let text = ctx.getAttachmentText();
  if (text && text.length >= 100) return text;

  // Try downloading from attachment URL (PDF/DOCX)
  const attachments = ctx.getAttachments();
  for (const att of attachments) {
    if (!att.url) continue;
    try {
      logger.log(`Extracting text from "${att.name}" (${att.mimeType})`);
      const extracted = await extractTextFromUrl(att.url, att.mimeType);
      if (extracted && extracted.length >= 100) return extracted;
    } catch (error) {
      logger.error(`Failed to extract from "${att.name}": ${error}`);
    }
  }

  throw new Error('No script text found. Please upload a file first.');
}

// ── Schema for analyze output (reuse from pipeline) ──

const analyzeOutputSchema = z.object({
  sessionId: z.string(),
  characters: z.number().describe('Number of characters found'),
  locations: z.number().describe('Number of locations found'),
  outlineSections: z.number().describe('Number of outline sections'),
  language: z.string().describe('Detected language'),
  style: z.string().describe('Genre/style'),
  summary: z.string().describe('Brief summary for AI to present'),
});

const episodeMapSchema = z.object({
  sessionId: z.string(),
  episodes: z.array(
    z.object({
      episodeNumber: z.number(),
      title: z.string(),
      outlineFrom: z.number().describe('Start outline index (inclusive)'),
      outlineTo: z.number().describe('End outline index (inclusive)'),
      summary: z.string(),
    }),
  ),
  summary: z.string(),
});

const writeResultSchema = mutationResultSchema;

// ── Tool definitions ──

export function createScriptAgentTools(
  ctx: AssistantToolContext,
  ai: AiService,
  store: ScriptAgentService,
) {
  const model = ai.getModel();

  return {
    /**
     * Tool 1: Analyze the uploaded script/novel.
     * Extracts characters, locations, outline, language, style.
     * For long texts (>30K chars), automatically chunks and merges.
     */
    analyze_text: tool({
      description:
        'Analyze an uploaded script/novel to extract characters, locations, and outline. ' +
        'Must be called AFTER configure_params. Text is read from the uploaded attachment automatically. ' +
        'Returns a sessionId for subsequent tools. Do NOT restate the text content.',
      inputSchema: z.object({
        title: z.string().optional().describe('Script/novel title'),
        config: z
          .object({
            episodes: z.number().optional(),
            durationMinutes: z.number().optional(),
            shotsPerMinute: z.number().optional(),
            style: z.string().optional(),
          })
          .optional(),
      }),
      outputSchema: analyzeOutputSchema,
      execute: async ({ title, config }) => {
        const text = await resolveText(ctx);
        const sessionId = randomId();

        logger.log(`analyze_text: ${text.length} chars, session=${sessionId}`);

        // Save text separately (large)
        await store.saveText(sessionId, text);

        // Run analyze step
        const context = {
          input: { text, config: config ?? {} },
          global: {} as Record<string, unknown>,
          stepResults: {} as Record<string, unknown>,
        };
        const noopEmit = () => {};
        const result = await analyzeStep(undefined, context, noopEmit, model);

        // Save state
        await store.saveState(sessionId, {
          title,
          config: config ?? {},
          analyze: result,
          language: result.language,
          style: result.style,
        });

        logger.log(
          `analyze_text done: ${result.characters.length} chars, ${result.locations.length} locs, lang=${result.language}`,
        );

        return {
          sessionId,
          characters: result.characters.length,
          locations: result.locations.length,
          outlineSections: result.outline.length,
          language: result.language,
          style: result.style,
          summary: `Analysis complete. Found ${result.characters.length} characters, ${result.locations.length} locations, ${result.outline.length} outline sections. Language: ${result.language}. Style: ${result.style}.`,
        };
      },
    }),

    /**
     * Tool 2: Map outline sections to episodes.
     * Uses AI to intelligently split the story into episodes.
     */
    map_episodes: tool({
      description:
        'Map the analyzed outline to episodes. Call after user confirms analyze_text results. ' +
        'Creates an episode mapping based on the target episode count.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from analyze_text'),
      }),
      outputSchema: episodeMapSchema,
      execute: async ({ sessionId }) => {
        const state = await store.getState(sessionId);
        if (!state)
          throw new Error('Session not found. Run analyze_text first.');
        const analyze = state.analyze as AnalyzeResult;
        const config = state.config as { episodes?: number } | undefined;
        const targetEpisodes = config?.episodes ?? 1;
        const language = (state.language as string) ?? 'English';

        logger.log(
          `map_episodes: ${analyze.outline.length} sections → ${targetEpisodes} episodes`,
        );

        const outlineSummary = analyze.outline
          .map((ch) => `${ch.index}. ${ch.title}: ${ch.summary}`)
          .join('\n');

        const mapResultSchema = z.object({
          episodes: z.array(
            z.object({
              episodeNumber: z.number(),
              title: z.string(),
              outlineFrom: z.number(),
              outlineTo: z.number(),
              summary: z.string(),
            }),
          ),
        });

        const { object } = await withRetry(
          () =>
            generateObject({
              model,
              schema: mapResultSchema,
              system: `You are a professional screenwriter. Map the following story outline into exactly ${targetEpisodes} episodes. Each episode should have a clear narrative arc. Output in ${language}.`,
              prompt: `Story outline (${analyze.outline.length} sections):\n\n${outlineSummary}`,
              temperature: 0.3,
            }),
          { maxRetries: 2, label: 'map-episodes' },
        );

        // Save to state
        await store.saveState(sessionId, {
          ...state,
          episodeMap: object.episodes,
        });

        logger.log(
          `map_episodes done: ${object.episodes.length} episodes mapped`,
        );

        return {
          sessionId,
          episodes: object.episodes,
          summary: `Mapped ${analyze.outline.length} sections into ${object.episodes.length} episodes.`,
        };
      },
    }),

    /**
     * Tool 3: Batch create episodes and assets in the project.
     * Creates episodes via Java API, then batch creates characters + scenes.
     */
    create_episodes_and_assets: tool({
      description:
        'Create episodes and assets (characters, scenes) in the project. ' +
        'Call after user confirms the episode mapping. ' +
        'This writes to the Java backend.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID'),
      }),
      outputSchema: writeResultSchema,
      execute: async ({ sessionId }) => {
        const state = await store.getState(sessionId);
        if (!state) throw new Error('Session not found.');
        const analyze = state.analyze as AnalyzeResult;
        const episodeMap = state.episodeMap as Array<{
          title: string;
          episodeNumber: number;
        }>;
        if (!episodeMap?.length)
          throw new Error('No episode mapping. Run map_episodes first.');

        const worldId = ctx.requireWorldId();
        const projectId = ctx.context.projectId;
        const results: string[] = [];

        // 1. Batch create episodes
        const titles = episodeMap.map((ep) => ep.title);
        logger.log(
          `Creating ${titles.length} episodes for project ${projectId}`,
        );
        try {
          await ctx.ws.batchAddEpisodes(ctx.headers, projectId, titles);
          results.push(`${titles.length} episodes`);
        } catch (error) {
          logger.error(`batchAddEpisodes failed: ${error}`);
          throw new Error(
            `Failed to create episodes: ${error instanceof Error ? error.message : error}`,
          );
        }

        // Re-fetch episode list to get actual IDs (reliable regardless of API response format)
        const allEpisodes = await ctx.ws.listEpisodes(ctx.headers, projectId);
        logger.log(`Project now has ${allEpisodes.length} episodes`);

        // 2. Batch create characters
        const characters = analyze.characters ?? [];
        if (characters.length > 0) {
          try {
            const roleDatas: string[][] = [
              ['name', 'description'],
              ...characters.map((c) => [c.name, c.description ?? '']),
            ];
            await ctx.ws.batchCreateRoles(ctx.headers, worldId, roleDatas);
            results.push(`${characters.length} characters`);
          } catch (error) {
            logger.error(`batchCreateRoles failed: ${error}`);
            results.push(`characters failed`);
          }
        }

        // 3. Batch create scenes
        const locations = analyze.locations ?? [];
        if (locations.length > 0) {
          try {
            const sceneDatas: string[][] = [
              ['name', 'description'],
              ...locations.map((l) => [l.name, l.description ?? '']),
            ];
            await ctx.ws.batchCreateScenes(ctx.headers, worldId, sceneDatas);
            results.push(`${locations.length} scenes`);
          } catch (error) {
            logger.error(`batchCreateScenes failed: ${error}`);
            results.push(`scenes failed`);
          }
        }

        // Save to state
        await store.saveState(sessionId, { ...state, episodesCreated: true });

        return buildMutationResult(
          'episode.batch_created',
          `Created ${results.join(', ')}`,
          'episode',
        );
      },
    }),

    /**
     * Tool 4: Generate scripts for a batch of episodes.
     * Supports batching: specify batchFrom/batchTo to process a range.
     * Each episode's script is written immediately after generation.
     */
    generate_scripts: tool({
      description:
        'Generate shootable-format scripts for a batch of episodes and save them. ' +
        'Call after episodes and assets are created. ' +
        'Use batchFrom/batchTo to process a range (e.g. 1-10, 11-20). ' +
        'For 30 episodes, call 3 times with batches of 10.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID'),
        batchFrom: z
          .number()
          .describe('Start episode number (inclusive, 1-based)'),
        batchTo: z.number().describe('End episode number (inclusive, 1-based)'),
      }),
      outputSchema: writeResultSchema,
      execute: async ({ sessionId, batchFrom, batchTo }) => {
        const state = await store.getState(sessionId);
        if (!state) throw new Error('Session not found.');
        const analyze = state.analyze as AnalyzeResult;
        const episodeMap = state.episodeMap as Array<{
          episodeNumber: number;
          title: string;
          outlineFrom: number;
          outlineTo: number;
          summary: string;
        }>;
        const language = (state.language as string) ?? 'English';
        const text = await store.getText(sessionId);
        if (!text) throw new Error('Source text not found.');

        // Fetch episode IDs from project (reliable, works regardless of who created them)
        const projectId = ctx.context.projectId;
        const allEpisodes = await ctx.ws.listEpisodes(ctx.headers, projectId);
        logger.log(
          `generate_scripts: project has ${allEpisodes.length} episodes`,
        );

        // Match episodes by title
        const batch = episodeMap.filter(
          (ep) => ep.episodeNumber >= batchFrom && ep.episodeNumber <= batchTo,
        );

        logger.log(
          `generate_scripts: batch ${batchFrom}-${batchTo} (${batch.length} episodes)`,
        );

        const characterList = analyze.characters
          .slice(0, 20)
          .map((c) => `${c.name}: ${c.description}`)
          .join('\n');

        let completed = 0;
        let saved = 0;
        const tasks = batch.map((ep) => async () => {
          const outlineSlice = analyze.outline
            .filter((o) => o.index >= ep.outlineFrom && o.index <= ep.outlineTo)
            .map((o) => `${o.title}: ${o.summary}`)
            .join('\n');

          const totalSections = analyze.outline.length;
          const startRatio = ep.outlineFrom / Math.max(totalSections, 1);
          const endRatio = (ep.outlineTo + 1) / Math.max(totalSections, 1);
          const sourceSegment = text.slice(
            Math.floor(text.length * startRatio),
            Math.floor(text.length * endRatio),
          );

          // Use generateText (not generateObject) for free-form script text
          const { text: scriptText } = await withRetry(
            () =>
              generateText({
                model,
                system: `You are a professional screenwriter. Write a shootable-format script for this episode.
Output in ${language}. Use this exact format:

EPISODE ${ep.episodeNumber} — "${ep.title}"

0:00-0:15
[Visual] Scene heading and visual description.
[SFX/Ambience] Sound effects.
CHARACTER NAME (parenthetical) Dialogue.

Rules:
- Every segment starts with a timecode (0:00-0:15 format)
- All visuals tagged with [Visual]
- All sounds tagged with [SFX/Ambience]
- Use line breaks between segments
- Do NOT output JSON, arrays, or structured data — output plain text only`,
                prompt: `Episode ${ep.episodeNumber}: "${ep.title}"\nSummary: ${ep.summary}\n\nOutline:\n${outlineSlice}\n\nCharacters:\n${characterList}\n\nSource text excerpt:\n${sourceSegment.slice(0, 8000)}`,
                temperature: 0.4,
              }),
            { maxRetries: 2, label: `script-ep-${ep.episodeNumber}` },
          );

          // Convert plain text to HTML for Tiptap editor
          const htmlContent = textToHtml(scriptText);

          // Find matching episode by title
          const match = allEpisodes.find((e) => e.title === ep.title);
          if (match) {
            try {
              await ctx.ws.saveEpisodeScript(
                ctx.headers,
                match.id,
                htmlContent,
              );
              saved++;
              logger.log(
                `Script saved: ep ${ep.episodeNumber} "${ep.title}" → ${match.id} (${scriptText.length} chars)`,
              );
            } catch (error) {
              logger.error(
                `Failed to save script for ep ${ep.episodeNumber}: ${error}`,
              );
            }
          } else {
            logger.warn(`No matching episode found for "${ep.title}"`);
          }

          completed++;
          logger.log(`Scripts: ${completed}/${batch.length} done`);
        });

        await runWithConcurrency(tasks, 5);

        return buildMutationResult(
          'storyboard.saved',
          `Generated scripts for episodes ${batchFrom}-${batchTo} (${saved}/${completed} saved)`,
          'episode',
        );
      },
    }),

    /**
     * Tool 5: Generate storyboard shots for a batch of episodes.
     * Each episode's shots are written to the correct episodeId.
     * Supports batching like generate_scripts.
     */
    generate_storyboard: tool({
      description:
        'Generate storyboard shots for a batch of episodes and save to storyboard table. ' +
        'Use batchFrom/batchTo to process a range (e.g. 1-10, 11-20). ' +
        'Each episode gets its own shots written to the correct episode.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID'),
        batchFrom: z
          .number()
          .describe('Start episode number (inclusive, 1-based)'),
        batchTo: z.number().describe('End episode number (inclusive, 1-based)'),
      }),
      outputSchema: writeResultSchema,
      execute: async ({ sessionId, batchFrom, batchTo }) => {
        const state = await store.getState(sessionId);
        if (!state) throw new Error('Session not found.');
        const analyze = state.analyze as AnalyzeResult;
        const episodeMap = state.episodeMap as Array<{
          episodeNumber: number;
          title: string;
          outlineFrom: number;
          outlineTo: number;
          summary: string;
        }>;
        const language = (state.language as string) ?? 'English';
        const config =
          (state.config as { shotsPerMinute?: number; style?: string }) ?? {};
        const text = await store.getText(sessionId);
        if (!text) throw new Error('Source text not found.');

        const shotsPerMinute = config.shotsPerMinute ?? 15;
        const style = config.style ?? analyze.style;

        // Fetch episode IDs from project
        const projectId = ctx.context.projectId;
        const allEpisodes = await ctx.ws.listEpisodes(ctx.headers, projectId);

        const batch = episodeMap.filter(
          (ep) => ep.episodeNumber >= batchFrom && ep.episodeNumber <= batchTo,
        );

        logger.log(
          `generate_storyboard: batch ${batchFrom}-${batchTo} (${batch.length} episodes), ${shotsPerMinute} shots/min`,
        );

        const characterList = analyze.characters
          .slice(0, 20)
          .map((c) => `${c.name}: ${c.description}`)
          .join('\n');

        const shotSchema = z.object({
          shots: z.array(
            z.object({
              description: z.string(),
              dialogue: z.string().optional(),
              shotSize: z.string(),
              cameraMovement: z.string(),
              duration: z.number(),
              videoPrompt: z.string().describe('ALWAYS in English'),
            }),
          ),
        });

        let totalShots = 0;
        let completed = 0;
        let saved = 0;

        const tasks = batch.map((ep) => async () => {
          const outlineSlice = analyze.outline
            .filter((o) => o.index >= ep.outlineFrom && o.index <= ep.outlineTo)
            .map((o) => `${o.title}: ${o.summary}`)
            .join('\n');

          const totalSections = analyze.outline.length;
          const startRatio = ep.outlineFrom / Math.max(totalSections, 1);
          const endRatio = (ep.outlineTo + 1) / Math.max(totalSections, 1);
          const sourceSegment = text.slice(
            Math.floor(text.length * startRatio),
            Math.floor(text.length * endRatio),
          );

          const { object } = await withRetry(
            () =>
              generateObject({
                model,
                schema: shotSchema,
                system: `You are a professional storyboard artist. Generate shots for this episode. Shot density: ~${shotsPerMinute} shots/minute. Visual style: ${style}. description, dialogue must be in ${language}. videoPrompt must ALWAYS be in English.`,
                prompt: `Episode ${ep.episodeNumber}: "${ep.title}"\n${ep.summary}\n\nOutline:\n${outlineSlice}\n\nCharacters:\n${characterList}\n\nSource:\n${sourceSegment.slice(0, 8000)}`,
                temperature: 0.4,
              }),
            { maxRetries: 2, label: `storyboard-ep-${ep.episodeNumber}` },
          );

          totalShots += object.shots.length;

          // Write to correct episode by title match
          const match = allEpisodes.find((e) => e.title === ep.title);
          if (match && object.shots.length > 0) {
            const headers = [
              'description',
              'dialogue',
              'shot_size',
              'movement',
              'duration',
              'video_prompt',
            ];
            const rows = object.shots.map((shot) => [
              shot.description,
              shot.dialogue ?? '',
              shot.shotSize,
              shot.cameraMovement,
              String(shot.duration),
              shot.videoPrompt,
            ]);

            try {
              await ctx.ws.saveStoryboardDraft(ctx.headers, {
                episodeId: match.id,
                headers,
                rows,
              });
              saved++;
              logger.log(
                `Storyboard saved: ep ${ep.episodeNumber} → ${match.id} (${object.shots.length} shots)`,
              );
            } catch (error) {
              logger.error(
                `Failed to save storyboard for ep ${ep.episodeNumber}: ${error}`,
              );
            }
          } else if (!match) {
            logger.warn(`No matching episode for "${ep.title}"`);
          }

          completed++;
          logger.log(
            `Storyboard: ${completed}/${batch.length}, ${totalShots} total shots`,
          );
        });

        await runWithConcurrency(tasks, 5);

        return buildMutationResult(
          'storyboard.pipeline_applied',
          `Episodes ${batchFrom}-${batchTo}: ${totalShots} shots generated (${saved}/${completed} saved)`,
          'storyboard',
        );
      },
    }),
  };
}
