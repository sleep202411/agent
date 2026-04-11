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
import { loadPipelinePrompt } from '../prompts';
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
  taskId: z.string().optional().describe('Background task ID (async mode)'),
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
        'Returns a taskId for async processing — tell the user analysis has started and progress will be shown. ' +
        'Do NOT restate the text content.',
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
        const taskService = ctx.taskService;
        const taskQueue = ctx.taskQueue;

        // Resolve text and attachment info
        const text = await resolveText(ctx);
        const sessionId = randomId();
        const attachments = ctx.getAttachments();
        const firstAttachment = attachments[0];

        logger.log(`analyze_text: ${text.length} chars, session=${sessionId}`);

        // If task infrastructure is available, run async
        if (taskService && taskQueue) {
          const task = await taskService.create({
            type: 'analyze',
            projectId: ctx.context.projectId,
            userId: ctx.userId,
            sessionId,
            input: {
              title,
              config: config ?? {},
              attachmentUrl: firstAttachment?.url,
              attachmentMimeType: firstAttachment?.mimeType,
              // Don't store full text in task.input — it's saved separately below
            },
          });

          // Save text first, then session state — ensures text is available if crash occurs
          await taskService.saveText(task.id, text);
          await store.saveState(sessionId, { title, config: config ?? {} });

          // Enqueue via BullMQ for background processing
          await taskQueue.enqueue(task.id);

          logger.log(
            `analyze_text: task ${task.id} enqueued for async processing`,
          );

          return {
            sessionId,
            taskId: task.id,
            characters: 0,
            locations: 0,
            outlineSections: 0,
            language: '',
            style: '',
            summary: `Analysis task started (${text.length} characters). Task ID: ${task.id}. Progress will be shown in the task card.`,
          };
        }

        // Fallback: synchronous processing (no Redis)
        logger.log(`analyze_text: no task service, running synchronously`);
        await store.saveText(sessionId, text);

        const context = {
          input: { text, config: config ?? {} },
          global: {} as Record<string, unknown>,
          stepResults: {} as Record<string, unknown>,
        };
        const noopEmit = () => {};
        const result = await analyzeStep(undefined, context, noopEmit, model);

        await store.saveState(sessionId, {
          title,
          config: config ?? {},
          analyze: result,
          language: result.language,
          style: result.style,
        });

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
              system: loadPipelinePrompt('episode-mapping', {
                targetEpisodes,
                language,
              }),
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

        const projectId = ctx.context.projectId;
        const results: string[] = [];

        // 1. Create episodes sequentially, collecting IDs directly
        // Use plain titles without episode number prefix — frontend shows index
        const titles = episodeMap.map((ep) => ep.title);

        let orderedEpisodeIds: string[];
        try {
          orderedEpisodeIds = await ctx.ws.batchAddEpisodes(
            ctx.headers,
            projectId,
            titles,
          );
          const created = orderedEpisodeIds.filter(Boolean).length;
          results.push(`${created} episodes`);
          logger.log(`Created ${created}/${titles.length} episodes`);
        } catch (error) {
          logger.error(`batchAddEpisodes failed: ${error}`);
          throw new Error(
            `Failed to create episodes: ${error instanceof Error ? error.message : error}`,
          );
        }

        // Save ordered IDs to session for generate_scripts/storyboard
        await store.saveState(sessionId, {
          ...state,
          episodesCreated: true,
          orderedEpisodeIds,
          episodeTitles: titles,
        });

        // 2. Batch create characters + scenes (requires worldId)
        const worldId = ctx.context.worldId;
        if (worldId) {
          const characters = analyze.characters ?? [];
          if (characters.length > 0) {
            try {
              const roleDatas: string[][] = [
                ['name', 'description', 'prompt'],
                ...characters.map((c) => [
                  c.name,
                  c.description ?? '',
                  (c as Record<string, unknown>).prompt
                    ? String((c as Record<string, unknown>).prompt)
                    : (c.description ?? ''),
                ]),
              ];
              await ctx.ws.batchCreateRoles(ctx.headers, worldId, roleDatas);
              results.push(`${characters.length} characters`);
            } catch (error) {
              logger.error(`batchCreateRoles failed: ${error}`);
              results.push(`characters failed`);
            }
          }

          const locations = analyze.locations ?? [];
          if (locations.length > 0) {
            try {
              const sceneDatas: string[][] = [
                ['name', 'description', 'prompt'],
                ...locations.map((l) => [
                  l.name,
                  l.description ?? '',
                  (l as Record<string, unknown>).prompt
                    ? String((l as Record<string, unknown>).prompt)
                    : (l.description ?? ''),
                ]),
              ];
              await ctx.ws.batchCreateScenes(ctx.headers, worldId, sceneDatas);
              results.push(`${locations.length} scenes`);
            } catch (error) {
              logger.error(`batchCreateScenes failed: ${error}`);
              results.push(`scenes failed`);
            }
          }
        } else {
          logger.warn('No worldId — skipping character/scene creation');
          results.push('characters/scenes skipped (no worldId)');
        }

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
        const orderedEpisodeIds = (state.orderedEpisodeIds as string[]) ?? [];
        const language = (state.language as string) ?? 'English';
        const text = await store.getText(sessionId);
        if (!text) throw new Error('Source text not found.');
        const projectId = ctx.context.projectId;

        const batch = episodeMap.filter(
          (ep) => ep.episodeNumber >= batchFrom && ep.episodeNumber <= batchTo,
        );

        logger.log(
          `generate_scripts: batch ${batchFrom}-${batchTo} (${batch.length} episodes), ${orderedEpisodeIds.length} IDs in session`,
        );

        // Use ordered IDs from session, fallback to fetching from project
        let episodeIds = orderedEpisodeIds;
        if (episodeIds.length === 0) {
          const allEpisodes = await ctx.ws.listEpisodes(ctx.headers, projectId);
          const titles = episodeMap.map((ep) => ep.title);
          episodeIds = titles.map((title) => {
            const match = allEpisodes.find((e) => e.title === title);
            return match?.id ?? '';
          });
          logger.log(
            `Fetched episode IDs from project: ${episodeIds.filter(Boolean).length} matched`,
          );
        }

        const characterList = analyze.characters
          .slice(0, 20)
          .map((c) => `${c.name}: ${c.description}`)
          .join('\n');

        // Generate scripts in parallel
        let completed = 0;
        const scriptResults: Array<{ epIndex: number; html: string }> = [];

        const tasks = batch.map((ep) => async () => {
          const epIndex = ep.episodeNumber - 1;
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

          const { text: scriptText } = await withRetry(
            () =>
              generateText({
                model,
                system: loadPipelinePrompt('script-generation', {
                  language,
                  episodeNumber: ep.episodeNumber,
                  episodeTitle: ep.title,
                }),
                prompt: `Episode ${ep.episodeNumber}: "${ep.title}"\nSummary: ${ep.summary}\n\nOutline:\n${outlineSlice}\n\nCharacters:\n${characterList}\n\nSource text excerpt:\n${sourceSegment.slice(0, 8000)}`,
                temperature: 0.4,
              }),
            { maxRetries: 2, label: `script-ep-${ep.episodeNumber}` },
          );

          scriptResults.push({ epIndex, html: textToHtml(scriptText) });
          completed++;
          logger.log(
            `Scripts: ${completed}/${batch.length} generated (ep ${ep.episodeNumber}, ${scriptText.length} chars)`,
          );
        });

        await runWithConcurrency(tasks, 5);

        // Batch save all scripts at once
        const batchEpIds: string[] = [];
        const batchContents: string[] = [];

        for (const result of scriptResults.sort(
          (a, b) => a.epIndex - b.epIndex,
        )) {
          const epId = episodeIds[result.epIndex];
          if (epId) {
            batchEpIds.push(epId);
            batchContents.push(result.html);
          } else {
            logger.warn(`No episode ID for index ${result.epIndex}`);
          }
        }

        if (batchEpIds.length > 0) {
          try {
            await ctx.ws.batchSaveScripts(
              ctx.headers,
              projectId,
              batchEpIds,
              batchContents,
            );
            logger.log(`Batch saved ${batchEpIds.length} scripts`);
          } catch (error) {
            logger.error(
              `Batch save failed, falling back to individual saves: ${error}`,
            );
            for (let i = 0; i < batchEpIds.length; i++) {
              try {
                await ctx.ws.saveEpisodeScript(
                  ctx.headers,
                  batchEpIds[i],
                  batchContents[i],
                );
              } catch (e) {
                logger.error(
                  `Individual save failed for ${batchEpIds[i]}: ${e}`,
                );
              }
            }
          }
        }

        return buildMutationResult(
          'storyboard.saved',
          `Generated scripts for episodes ${batchFrom}-${batchTo} (${batchEpIds.length}/${completed} saved)`,
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
        const orderedEpisodeIds = (state.orderedEpisodeIds as string[]) ?? [];
        const language = (state.language as string) ?? 'English';
        const config =
          (state.config as { shotsPerMinute?: number; style?: string }) ?? {};
        const text = await store.getText(sessionId);
        if (!text) throw new Error('Source text not found.');

        const shotsPerMinute = config.shotsPerMinute ?? 15;
        const style = config.style ?? analyze.style;
        const projectId = ctx.context.projectId;

        // Use ordered IDs from session, fallback to fetching
        let episodeIds = orderedEpisodeIds;
        logger.log(
          `Session orderedEpisodeIds: ${episodeIds.length} IDs, first 3: ${episodeIds.slice(0, 3).join(', ')}`,
        );
        if (episodeIds.length === 0) {
          const allEpisodes = await ctx.ws.listEpisodes(ctx.headers, projectId);
          const titles = episodeMap.map((ep) => ep.title);
          logger.log(
            `Trying to match ${titles.length} titles against ${allEpisodes.length} episodes`,
          );
          episodeIds = titles.map((title) => {
            const match = allEpisodes.find((e) => e.title === title);
            return match?.id ?? '';
          });
          logger.log(
            `Fetched episode IDs: ${episodeIds.filter(Boolean).length}/${episodeIds.length} matched`,
          );
        }

        const batch = episodeMap.filter(
          (ep) => ep.episodeNumber >= batchFrom && ep.episodeNumber <= batchTo,
        );

        logger.log(
          `generate_storyboard: batch ${batchFrom}-${batchTo} (${batch.length} episodes), ${shotsPerMinute} shots/min`,
        );

        // ── Build mention lookup from world assets ──
        const worldId = ctx.context.worldId;
        type MentionEntry = {
          id: string;
          type: 'character' | 'scene';
          name: string;
          imgUrl: string;
        };
        const mentionMap = new Map<string, MentionEntry>();

        if (worldId) {
          try {
            const [charPage, scenePage] = await Promise.all([
              ctx.ws.getWorldAssetPage(ctx.headers, worldId, 'character', {
                pageSize: 100,
              }),
              ctx.ws.getWorldAssetPage(ctx.headers, worldId, 'scene', {
                pageSize: 100,
              }),
            ]);
            for (const c of (
              charPage as { list?: Array<Record<string, unknown>> }
            )?.list ?? []) {
              const name = String(c.name ?? '').trim();
              if (!name) continue;
              const imgPaths = Array.isArray(c.roleImgPath)
                ? c.roleImgPath
                : [];
              mentionMap.set(name.toLowerCase(), {
                id: String(c.id ?? ''),
                type: 'character',
                name,
                imgUrl: imgPaths[0] ? String(imgPaths[0]) : '',
              });
            }
            for (const s of (
              scenePage as { list?: Array<Record<string, unknown>> }
            )?.list ?? []) {
              const name = String(s.name ?? '').trim();
              if (!name) continue;
              const imgPaths = Array.isArray(s.sceneImgPath)
                ? s.sceneImgPath
                : [];
              mentionMap.set(name.toLowerCase(), {
                id: String(s.id ?? ''),
                type: 'scene',
                name,
                imgUrl: imgPaths[0] ? String(imgPaths[0]) : '',
              });
            }
            logger.log(
              `Built mention map: ${mentionMap.size} entries (characters + scenes)`,
            );
          } catch (error) {
            logger.warn(`Failed to load world assets for mentions: ${error}`);
          }
        }

        function buildMention(entry: MentionEntry): string {
          const attrs = [`id="${entry.id}"`, `type="${entry.type}"`];
          if (entry.imgUrl) attrs.push(`imgUrl="${entry.imgUrl}"`);
          return `<mention ${attrs.join(' ')}>${entry.name}</mention>`;
        }

        function injectMentions(text: string): string {
          // Sort by name length descending to avoid substring collisions
          // e.g. "王五" must be matched before "王"
          const sorted = [...mentionMap.values()].sort(
            (a, b) => b.name.length - a.name.length,
          );
          let result = text;
          for (const entry of sorted) {
            const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'gi');
            result = result.replace(regex, buildMention(entry));
          }
          return result;
        }

        function buildSceneMention(sceneName: string): string {
          const entry = mentionMap.get(sceneName.toLowerCase().trim());
          if (entry && entry.type === 'scene') return buildMention(entry);
          return sceneName;
        }

        // ── Shot generation schema (expanded) ──
        const characterList = analyze.characters
          .slice(0, 20)
          .map((c) => `${c.name}: ${c.description}`)
          .join('\n');

        const sceneList = analyze.locations
          .slice(0, 20)
          .map((l) => l.name)
          .join(', ');

        const shotSizeOptions =
          '超特写, 特写, 中景, 全景, 大全景, 双人镜头, 过肩, 主观, 插镜';
        const perspectiveOptions = '平视, 俯视, 仰视, 鸟瞰, 倾斜, 航拍, 背面';
        const movementOptions =
          '固定镜头, 推镜头, 拉镜头, 左移镜头, 右移镜头, 左摇镜头, 右摇镜头, 升镜头, 降镜头, 上摇镜头, 下摇镜头, 左旋镜头, 右旋镜头, 晃动镜头, 变焦推进, 变焦拉远, 场景镜头';

        const shotSchema = z.object({
          shots: z.array(
            z.object({
              scene: z
                .string()
                .describe(
                  `Scene/location name. Must be one of the known scenes: ${sceneList}. If none match, use a short descriptive name.`,
                ),
              description: z
                .string()
                .describe(
                  'Visual description for human readers: what happens in the shot, mood, details. Use character names.',
                ),
              imagePrompt: z
                .string()
                .describe(
                  'AI image generation prompt — pure visual ONLY. Describe composition, lighting, colors, character appearance. Use character names.',
                ),
              videoPrompt: z
                .string()
                .describe(
                  'AI video generation prompt — visual + motion. Use the output language specified by user.',
                ),
              dialogue: z
                .string()
                .optional()
                .describe(
                  'Dialogue and/or narration. Format: "角色名：台词" for dialogue, "旁白：内容" for narration. Empty if none.',
                ),
              shotSize: z
                .string()
                .describe(`Shot size. Choose from: ${shotSizeOptions}`),
              perspective: z
                .string()
                .describe(
                  `Camera perspective. Choose from: ${perspectiveOptions}`,
                ),
              movement: z
                .string()
                .describe(`Camera movement. Choose from: ${movementOptions}`),
              duration: z.number().describe('Duration in seconds, 2-8s'),
            }),
          ),
        });

        let totalShots = 0;
        let completed = 0;
        let saved = 0;

        const STORYBOARD_CHUNK_SIZE = 8000;
        const STORYBOARD_CHUNK_OVERLAP = 500;

        const storyboardSystemPrompt = loadPipelinePrompt(
          'storyboard-generation',
          {
            shotsPerMinute,
            style,
            language,
            sceneList,
            shotSizeOptions,
            perspectiveOptions,
            movementOptions,
          },
        );

        function splitSourceIntoChunks(source: string): string[] {
          if (source.length <= STORYBOARD_CHUNK_SIZE) return [source];
          const paragraphs = source.split(/\n\s*\n/);
          const chunks: string[] = [];
          let buffer = '';
          for (const para of paragraphs) {
            if (
              buffer.length + para.length > STORYBOARD_CHUNK_SIZE &&
              buffer.length > 0
            ) {
              chunks.push(buffer);
              buffer = buffer.slice(-STORYBOARD_CHUNK_OVERLAP);
            }
            buffer += (buffer ? '\n\n' : '') + para;
          }
          if (buffer.trim()) chunks.push(buffer);
          return chunks;
        }

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

          const sourceChunks = splitSourceIntoChunks(sourceSegment);
          logger.log(
            `Storyboard ep ${ep.episodeNumber}: source ${sourceSegment.length} chars → ${sourceChunks.length} chunks`,
          );

          const allShots: Array<{
            scene: string;
            description: string;
            imagePrompt: string;
            videoPrompt: string;
            dialogue?: string;
            shotSize: string;
            perspective: string;
            movement: string;
            duration: number;
          }> = [];

          for (let ci = 0; ci < sourceChunks.length; ci++) {
            const chunk = sourceChunks[ci];
            const chunkContext =
              sourceChunks.length > 1
                ? `\n\n[Chunk ${ci + 1}/${sourceChunks.length} — continue shot numbering from ${allShots.length + 1}]`
                : '';

            const { object } = await withRetry(
              () =>
                generateObject({
                  model,
                  schema: shotSchema,
                  system: storyboardSystemPrompt,
                  prompt: `Episode ${ep.episodeNumber}: "${ep.title}"\n${ep.summary}\n\nOutline:\n${outlineSlice}\n\nCharacters:\n${characterList}${chunkContext}\n\nSource text:\n${chunk}`,
                  temperature: 0.4,
                }),
              {
                maxRetries: 2,
                label: `storyboard-ep-${ep.episodeNumber}-chunk-${ci}`,
              },
            );

            allShots.push(...object.shots);
            logger.log(
              `Storyboard ep ${ep.episodeNumber} chunk ${ci + 1}/${sourceChunks.length}: ${object.shots.length} shots (total: ${allShots.length})`,
            );
          }

          totalShots += allShots.length;

          // Write to correct episode by index
          const epId = episodeIds[ep.episodeNumber - 1];
          if (epId && allShots.length > 0) {
            const headers = [
              'shot_no',
              'scene',
              'description',
              'image_prompt',
              'video_prompt',
              'style_planting',
              'movement',
              'dialogue',
              'shot_size',
              'perspective',
              'duration',
            ];
            const rows = allShots.map((shot, shotIndex) => [
              String(shotIndex + 1), // shot_no
              buildSceneMention(shot.scene), // scene with mention
              injectMentions(shot.description), // description with mentions
              injectMentions(shot.imagePrompt), // image_prompt with mentions
              injectMentions(shot.videoPrompt), // video_prompt with mentions
              style, // style_planting (project-level style)
              shot.movement,
              shot.dialogue ?? '',
              shot.shotSize,
              shot.perspective,
              String(shot.duration),
            ]);

            try {
              await ctx.ws.saveStoryboardDraft(ctx.headers, {
                episodeId: epId,
                headers,
                rows,
              });
              saved++;
              logger.log(
                `Storyboard saved: ep ${ep.episodeNumber} → ${epId} (${allShots.length} shots, ${headers.length} columns)`,
              );
            } catch (error) {
              logger.error(
                `Failed to save storyboard for ep ${ep.episodeNumber}: ${error}`,
              );
            }
          } else if (!epId) {
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
