import { Logger } from '@nestjs/common';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { generateObject } from 'ai';
import { TaskService } from './task.service';
import { RateLimiter } from './rate-limiter';
import type { PipelineTask } from './task.types';
import { withRetry } from '../engine/retry';
import { extractTextFromUrl } from '../engine/file-extract';
import {
  analyzeResultSchema,
  type AnalyzeResult,
} from '../pipelines/novel-to-storyboard/schemas';

const logger = new Logger('TaskWorker');

// ─── Text chunking ──────────────────────────────────────

const FULL_TEXT_THRESHOLD = 30_000;
const CHUNK_TARGET_SIZE = 15_000;
const CHUNK_OVERLAP = 500;
const CHUNK_CONCURRENCY = 3;
const LLM_CALL_TIMEOUT = 90_000;

function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (buffer.length + para.length > CHUNK_TARGET_SIZE && buffer.length > 0) {
      chunks.push(buffer);
      buffer = buffer.slice(-CHUNK_OVERLAP);
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }
  if (buffer.trim()) chunks.push(buffer);

  return chunks;
}

// ─── LLM Prompts ────────────────────────────────────────

const FULL_TEXT_SYSTEM_PROMPT = `You are a professional novel/screenplay analyst. Analyze the full text and extract structured information.

Requirements:
1. **Characters**: Extract all named characters. Merge different names for the same person.
2. **Locations**: Extract all locations/settings.
3. **Outline**: One-sentence summary for each chapter or major section.
4. **Style**: Genre (realistic/fantasy/sci-fi/romance/mystery etc.).
5. **Language**: Primary language of the source text.

Important:
- The aliases field must list ALL name variants.
- Outline index starts from 0.
- ALL output text must be in the SAME LANGUAGE as the source text.`;

const CHUNK_SYSTEM_PROMPT = `You are a professional novel/screenplay analyst. Analyze this text segment.

Requirements:
1. Extract all characters (with aliases) and locations from this segment.
2. Write one outline entry (title + one-sentence summary).
3. Determine the genre/style.
4. Detect the language.

Important:
- Only extract info present in this segment.
- Outline index starts from 0 within this segment.
- ALL output must be in the SAME LANGUAGE as the source text.`;

const DEDUP_SYSTEM_PROMPT = `You are a text analysis expert. Merge duplicate characters and locations from multiple segments.

1. **Merge characters**: Combine entries for the same person. Keep the most complete description.
2. **Merge locations**: Combine entries for the same place.
3. Output deduplicated lists.
4. ALL output must remain in the SAME LANGUAGE as the input.`;

// ─── Merge helpers ──────────────────────────────────────

function codeMergeResults(partials: AnalyzeResult[]): AnalyzeResult {
  const charMap = new Map<string, AnalyzeResult['characters'][number]>();
  for (const partial of partials) {
    for (const char of partial.characters) {
      const key = char.name.toLowerCase().trim();
      const existing = charMap.get(key);
      if (existing) {
        existing.aliases = [...new Set([...existing.aliases, ...char.aliases])];
        if (char.description.length > existing.description.length) {
          existing.description = char.description;
        }
      } else {
        charMap.set(key, { ...char });
      }
    }
  }

  const locMap = new Map<string, AnalyzeResult['locations'][number]>();
  for (const partial of partials) {
    for (const loc of partial.locations) {
      const key = loc.name.toLowerCase().trim();
      if (!locMap.has(key)) locMap.set(key, loc);
    }
  }

  const outlines = partials.flatMap((p) => p.outline);
  outlines.forEach((item, i) => {
    item.index = i;
  });

  return {
    characters: [...charMap.values()],
    locations: [...locMap.values()],
    outline: outlines,
    style: partials.find((p) => p.style)?.style ?? 'realistic',
    timePeriod: partials.find((p) => p.timePeriod)?.timePeriod,
    language: partials.find((p) => p.language)?.language ?? 'English',
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ─── Worker ─────────────────────────────────────────────

export class TaskWorker {
  private readonly rateLimiter = new RateLimiter();

  constructor(
    private readonly taskService: TaskService,
    private readonly getModel: () => LanguageModelV3,
    private readonly saveSessionState?: (
      sessionId: string,
      state: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  /**
   * Process a single task by ID. Called by BullMQ worker or directly.
   */
  async processTask(taskId: string): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task || task.status !== 'queued') return;

    logger.log(`[worker] Starting task ${taskId} type=${task.type}`);

    try {
      switch (task.type) {
        case 'analyze':
          await this.runAnalyze(task);
          break;
        default:
          await this.taskService.updateProgress(taskId, {
            status: 'failed',
            error: `Unknown task type: ${task.type}`,
          });
      }

      // Post-complete hook (billing)
      const finalTask = await this.taskService.getTask(taskId);
      if (finalTask) {
        await this.taskService.markCompleted(finalTask);
      }
    } catch (error) {
      logger.error(`[worker] Task ${taskId} failed: ${error}`);
      await this.taskService.updateProgress(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: Date.now(),
      });
    }
  }

  // ─── Analyze ───────────────────────────────────────────

  private async runAnalyze(task: PipelineTask): Promise<void> {
    const model = this.getModel();
    const taskId = task.id;
    const sessionId = task.sessionId;
    const attachmentUrl = task.input.attachmentUrl as string | undefined;
    const attachmentMimeType = task.input.attachmentMimeType as
      | string
      | undefined;
    const config = task.input.config as Record<string, unknown> | undefined;

    // 1. Download file
    logger.log(
      `[analyze:${taskId}] Starting. sessionId=${sessionId}, attachmentUrl=${attachmentUrl?.slice(0, 80)}, mimeType=${attachmentMimeType}`,
    );

    await this.taskService.updateProgress(taskId, {
      status: 'processing',
      phase: 'downloading',
      message: 'Downloading file...',
      startedAt: Date.now(),
    });

    // Text is stored separately via saveText() to avoid duplicating in task.input
    let text = (await this.taskService.getText(taskId)) ?? undefined;
    if (text) {
      logger.log(
        `[analyze:${taskId}] Text from Redis cache: ${text.length} chars`,
      );
    }
    if (!text && attachmentUrl) {
      logger.log(`[analyze:${taskId}] Downloading from URL...`);
      const downloadStart = Date.now();
      text = await withTimeout(
        extractTextFromUrl(attachmentUrl, attachmentMimeType),
        30_000,
      );
      logger.log(
        `[analyze:${taskId}] Downloaded ${text.length} chars in ${Date.now() - downloadStart}ms`,
      );
      await this.taskService.saveText(taskId, text);
    }
    if (!text || text.length < 100) {
      logger.error(
        `[analyze:${taskId}] Text too short or missing: ${text?.length ?? 0} chars`,
      );
      throw new Error('No text found or text too short');
    }

    logger.log(
      `[analyze:${taskId}] Ready: ${text.length} chars, threshold=${FULL_TEXT_THRESHOLD}`,
    );

    let result: AnalyzeResult;

    if (text.length <= FULL_TEXT_THRESHOLD) {
      // ── Short text: single LLM call ──
      logger.log(`[analyze:${taskId}] Short text mode (single call)`);

      await this.taskService.updateProgress(taskId, {
        phase: 'analyzing',
        chunksTotal: 1,
        chunksCompleted: 0,
        message: `Analyzing (${text.length} chars)...`,
      });

      const llmStart = Date.now();
      result = await this.callLLM(model, FULL_TEXT_SYSTEM_PROMPT, text);
      logger.log(
        `[analyze:${taskId}] Single call done in ${Date.now() - llmStart}ms: ${result.characters.length} chars, ${result.locations.length} locs, ${result.outline.length} outline`,
      );

      await this.taskService.updateProgress(taskId, {
        chunksCompleted: 1,
        progress: 80,
      });
    } else {
      // ── Long text: chunk → analyze → merge → dedup ──
      const chunks = splitIntoChunks(text);
      logger.log(
        `[analyze:${taskId}] Long text mode: ${chunks.length} chunks (sizes: ${chunks.map((c) => c.length).join(', ')})`,
      );

      await this.taskService.updateProgress(taskId, {
        phase: 'analyzing',
        chunksTotal: chunks.length,
        message: `Analyzing 0/${chunks.length} segments...`,
      });

      const partials: AnalyzeResult[] = [];
      let completed = 0;
      const analyzeStart = Date.now();

      for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
        // Check cancellation
        const current = await this.taskService.getTask(taskId);
        if (current?.status === 'cancelled') {
          logger.log(`[analyze:${taskId}] Cancelled at chunk ${i}`);
          return;
        }

        const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
        logger.log(
          `[analyze:${taskId}] Processing batch ${i / CHUNK_CONCURRENCY + 1}: chunks ${i + 1}-${i + batch.length}/${chunks.length}`,
        );
        const batchStart = Date.now();

        const batchResults = await Promise.all(
          batch.map(async (chunk, bi) => {
            const ci = i + bi;
            const cached = await this.taskService.getChunkResult(taskId, ci);
            if (cached) {
              logger.log(`[analyze:${taskId}] Chunk ${ci + 1} from cache`);
              return cached as AnalyzeResult;
            }

            const chunkStart = Date.now();
            const r = await this.callLLM(model, CHUNK_SYSTEM_PROMPT, chunk);
            logger.log(
              `[analyze:${taskId}] Chunk ${ci + 1} done in ${Date.now() - chunkStart}ms: ${r.characters.length} chars, ${r.locations.length} locs`,
            );
            await this.taskService.saveChunkResult(taskId, ci, r);
            return r;
          }),
        );

        logger.log(
          `[analyze:${taskId}] Batch done in ${Date.now() - batchStart}ms`,
        );
        partials.push(...batchResults);
        completed += batch.length;

        await this.taskService.updateProgress(taskId, {
          chunksCompleted: completed,
          progress: Math.round((completed / chunks.length) * 70),
          message: `Analyzed ${completed}/${chunks.length} segments`,
        });
      }

      logger.log(
        `[analyze:${taskId}] All chunks done in ${Date.now() - analyzeStart}ms`,
      );

      // Merge
      await this.taskService.updateProgress(taskId, {
        phase: 'merging',
        progress: 75,
        message: 'Merging results...',
      });
      const merged = codeMergeResults(partials);
      logger.log(
        `[analyze:${taskId}] Code merge: ${merged.characters.length} chars, ${merged.locations.length} locs (before dedup)`,
      );

      // Dedup
      await this.taskService.updateProgress(taskId, {
        phase: 'deduping',
        progress: 80,
        message: `Deduplicating ${merged.characters.length} characters...`,
      });

      try {
        const dedupInput = JSON.stringify({
          characters: merged.characters.map((c) => ({
            name: c.name,
            aliases: c.aliases,
            role: c.role,
            description: c.description,
          })),
          locations: merged.locations.map((l) => ({
            name: l.name,
            description: l.description,
          })),
        });
        logger.log(
          `[analyze:${taskId}] Dedup input: ${dedupInput.length} chars`,
        );

        const dedupSchema = analyzeResultSchema.pick({
          characters: true,
          locations: true,
        });

        const dedupStart = Date.now();
        await this.rateLimiter.acquire('default');
        try {
          const { object: deduped } = await withRetry(
            () =>
              withTimeout(
                generateObject({
                  model,
                  schema: dedupSchema,
                  system: DEDUP_SYSTEM_PROMPT,
                  prompt: dedupInput,
                  temperature: 0.1,
                }),
                LLM_CALL_TIMEOUT,
              ),
            { maxRetries: 2, label: 'dedup' },
          );

          logger.log(
            `[analyze:${taskId}] Dedup done in ${Date.now() - dedupStart}ms: ${merged.characters.length}→${deduped.characters.length} chars, ${merged.locations.length}→${deduped.locations.length} locs`,
          );

          result = {
            ...merged,
            characters: deduped.characters,
            locations: deduped.locations,
          };
        } finally {
          this.rateLimiter.release('default');
        }
      } catch (error) {
        logger.warn(
          `[analyze:${taskId}] Dedup failed (using code-merged): ${error}`,
        );
        result = merged;
      }
    }

    // Save to session
    if (sessionId && this.saveSessionState) {
      await this.saveSessionState(sessionId, {
        title: task.input.title,
        config: config ?? {},
        analyze: result,
        language: result.language,
        style: result.style,
      });
    }

    // Done
    await this.taskService.updateProgress(taskId, {
      status: 'done',
      phase: 'done',
      progress: 100,
      message: `Found ${result.characters.length} characters, ${result.locations.length} locations, ${result.outline.length} sections`,
      result: {
        sessionId,
        characters: result.characters.length,
        locations: result.locations.length,
        outlineSections: result.outline.length,
        language: result.language,
        style: result.style,
      },
      completedAt: Date.now(),
    });
  }

  private async callLLM(
    model: LanguageModelV3,
    systemPrompt: string,
    text: string,
  ): Promise<AnalyzeResult> {
    logger.log(
      `[callLLM] Acquiring rate limiter slot (text=${text.length} chars)...`,
    );
    const waitStart = Date.now();
    await this.rateLimiter.acquire('default');
    const waitTime = Date.now() - waitStart;
    if (waitTime > 1000) {
      logger.log(`[callLLM] Rate limiter wait: ${waitTime}ms`);
    }

    const callStart = Date.now();
    try {
      const { object } = await withRetry(
        () =>
          withTimeout(
            generateObject({
              model,
              schema: analyzeResultSchema,
              system: systemPrompt,
              prompt: text,
              temperature: 0.3,
            }),
            LLM_CALL_TIMEOUT,
          ),
        { maxRetries: 2, label: 'analyze-llm' },
      );
      logger.log(`[callLLM] Done in ${Date.now() - callStart}ms`);
      return object;
    } catch (error) {
      logger.error(
        `[callLLM] Failed after ${Date.now() - callStart}ms: ${error}`,
      );
      throw error;
    } finally {
      this.rateLimiter.release('default');
    }
  }
}
