import { Logger } from '@nestjs/common';
import { generateObject } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { withRetry, runWithConcurrency } from '../../engine/retry';
import { loadPipelinePrompt } from '../../../assistant/prompts';

/** Minimal context type — replaces the old pipeline engine types */
export type AnalyzeContext = {
  input: Record<string, unknown>;
  global: Record<string, unknown>;
  stepResults: Record<string, unknown>;
};

type EmitFn = (...args: unknown[]) => void;
import { analyzeResultSchema, type AnalyzeResult } from './schemas';

const logger = new Logger('AnalyzeStep');

/**
 * Texts below this threshold go full-text in one LLM call.
 * Above this, split into chunks and analyze in parallel.
 */
const FULL_TEXT_THRESHOLD = 30_000;
const CHUNK_TARGET_SIZE = 15_000;
const CHUNK_OVERLAP = 500;
const ANALYZE_CONCURRENCY = 8;

// ── Prompts ──

const FULL_TEXT_SYSTEM_PROMPT = loadPipelinePrompt('analyze-full');
const CHUNK_SYSTEM_PROMPT = loadPipelinePrompt('analyze-chunk');
const DEDUP_SYSTEM_PROMPT = loadPipelinePrompt('analyze-dedup');

// ── Helpers ──

/**
 * Split text into overlapping chunks at paragraph boundaries.
 */
function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (buffer.length + para.length > CHUNK_TARGET_SIZE && buffer.length > 0) {
      chunks.push(buffer);
      const tail = buffer.slice(-CHUNK_OVERLAP);
      buffer = tail;
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }

  if (buffer.trim()) {
    chunks.push(buffer);
  }

  return chunks;
}

/**
 * Code-level merge: fast pass to combine partial results.
 * Deduplicates by exact name match. Semantic dedup is done by LLM afterwards.
 */
function codeMergeResults(partials: AnalyzeResult[]): AnalyzeResult {
  const charMap = new Map<string, AnalyzeResult['characters'][number]>();
  for (const partial of partials) {
    for (const char of partial.characters) {
      const key = char.name.toLowerCase().trim();
      const existing = charMap.get(key);
      if (existing) {
        const allAliases = new Set([...existing.aliases, ...char.aliases]);
        existing.aliases = [...allAliases];
        if (char.description.length > existing.description.length) {
          existing.description = char.description;
        }
        if (
          char.relationships &&
          (!existing.relationships ||
            char.relationships.length > existing.relationships.length)
        ) {
          existing.relationships = char.relationships;
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
      if (!locMap.has(key)) {
        locMap.set(key, loc);
      }
    }
  }

  const outlines = partials.flatMap((p) => p.outline);
  outlines.forEach((item, i) => {
    item.index = i;
  });

  const styles = partials.map((p) => p.style).filter(Boolean);
  const style = styles[0] ?? 'realistic';
  const timePeriod = partials.find((p) => p.timePeriod)?.timePeriod;
  const languages = partials.map((p) => p.language).filter(Boolean);
  const language = languages[0] ?? 'English';

  return {
    characters: [...charMap.values()],
    locations: [...locMap.values()],
    outline: outlines,
    style,
    timePeriod,
    language,
  };
}

// ── Main ──

export type AnalyzeProgressCallback = (progress: {
  phase: 'chunking' | 'analyzing' | 'merging' | 'deduping' | 'done';
  current: number;
  total: number;
  message: string;
}) => void;

export async function analyzeStep(
  _input: unknown,
  context: AnalyzeContext,
  emit: EmitFn,
  model: LanguageModelV3,
  onProgress?: AnalyzeProgressCallback,
): Promise<AnalyzeResult> {
  const text = context.input.text as string;
  logger.log(
    `Starting analyze step: ${text.length} chars, threshold=${FULL_TEXT_THRESHOLD}, config=${JSON.stringify(context.input.config ?? {})}`,
  );

  let result: AnalyzeResult;

  if (text.length <= FULL_TEXT_THRESHOLD) {
    // ── Short text: single LLM call ──
    logger.log(`Short text mode: single LLM call with ${text.length} chars`);
    emit({
      type: 'step:progress',
      stepId: 'analyze',
      current: 0,
      total: 1,
      message: `正在分析全文（${text.length} 字）...`,
    });

    const { object } = await withRetry(
      () =>
        generateObject({
          model,
          schema: analyzeResultSchema,
          system: FULL_TEXT_SYSTEM_PROMPT,
          prompt: text,
          temperature: 0.3,
        }),
      { maxRetries: 2, label: 'analyze-full' },
    );

    logger.log(
      `Full-text analyze done: ${object.characters.length} characters, ${object.locations.length} locations, ${object.outline.length} outline items`,
    );
    result = object;
  } else {
    // ── Long text: split → parallel analyze → code merge → LLM dedup ──
    const chunks = splitIntoChunks(text);
    logger.log(
      `Long text mode: ${text.length} chars → ${chunks.length} chunks (target ${CHUNK_TARGET_SIZE}/chunk, overlap ${CHUNK_OVERLAP})`,
    );
    logger.log(`Chunk sizes: ${chunks.map((c) => c.length).join(', ')}`);

    onProgress?.({
      phase: 'chunking',
      current: 0,
      total: chunks.length,
      message: `Split into ${chunks.length} chunks`,
    });

    // Phase 1: Parallel chunk analysis
    let completed = 0;
    const tasks = chunks.map((chunk, i) => async (): Promise<AnalyzeResult> => {
      logger.log(
        `Analyzing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`,
      );
      const { object } = await withRetry(
        () =>
          generateObject({
            model,
            schema: analyzeResultSchema,
            system: CHUNK_SYSTEM_PROMPT,
            prompt: chunk,
            temperature: 0.3,
          }),
        { maxRetries: 2, label: `analyze-chunk-${i + 1}` },
      );
      completed++;
      logger.log(
        `Chunk ${i + 1} done: ${object.characters.length} chars, ${object.locations.length} locs`,
      );
      onProgress?.({
        phase: 'analyzing',
        current: completed,
        total: chunks.length,
        message: `Analyzed ${completed}/${chunks.length} chunks`,
      });
      return object;
    });

    const partials = await runWithConcurrency(tasks, ANALYZE_CONCURRENCY);

    // Phase 2: Code-level merge (fast, exact match)
    const codeMerged = codeMergeResults(partials);
    logger.log(
      `Code merge done: ${codeMerged.characters.length} characters, ${codeMerged.locations.length} locations (before LLM dedup)`,
    );

    // Phase 3: LLM dedup (semantic merge)
    onProgress?.({
      phase: 'deduping',
      current: 0,
      total: 1,
      message: `Deduplicating ${codeMerged.characters.length} characters, ${codeMerged.locations.length} locations...`,
    });

    // Slim dedup input: only names + aliases (no descriptions) to reduce tokens
    const dedupInput = JSON.stringify(
      {
        characters: codeMerged.characters.map((c) => ({
          name: c.name,
          aliases: c.aliases,
          role: c.role,
        })),
        locations: codeMerged.locations.map((l) => ({
          name: l.name,
        })),
      },
      null,
      0,
    );

    logger.log(`LLM dedup input: ${dedupInput.length} chars`);

    const dedupSchema = analyzeResultSchema.pick({
      characters: true,
      locations: true,
    });

    try {
      const { object: deduped } = await withRetry(
        () =>
          generateObject({
            model,
            schema: dedupSchema,
            system: DEDUP_SYSTEM_PROMPT,
            prompt: dedupInput,
            temperature: 0.1,
          }),
        { maxRetries: 2, label: 'analyze-dedup' },
      );

      logger.log(
        `LLM dedup done: ${codeMerged.characters.length} → ${deduped.characters.length} characters, ${codeMerged.locations.length} → ${deduped.locations.length} locations`,
      );

      result = {
        characters: deduped.characters,
        locations: deduped.locations,
        outline: codeMerged.outline,
        style: codeMerged.style,
        timePeriod: codeMerged.timePeriod,
        language: codeMerged.language,
      };
    } catch (error) {
      // LLM dedup failed — fall back to code-merged result
      logger.warn(`LLM dedup failed, using code-merged result: ${error}`);
      result = codeMerged;
    }
  }

  // Write results to global context
  context.global.characters = result.characters;
  context.global.locations = result.locations;
  context.global.outline = result.outline;
  context.global.style = result.style;
  context.global.language = result.language ?? 'English';

  logger.log(`Detected language: ${result.language}`);
  logger.log(
    `Analyze step complete: ${result.characters.length} characters, ${result.locations.length} locations, ${result.outline.length} outline items, style="${result.style}"`,
  );

  emit({
    type: 'step:progress',
    stepId: 'analyze',
    current: 1,
    total: 1,
    message: `提取到 ${result.characters.length} 个角色，${result.locations.length} 个场景`,
  });

  return result;
}
