/**
 * Spark — analyzes a novel/script upload and proposes IP metadata.
 *
 *   1. Extract plain text from the upload (PDF / DOCX / TXT / MD).
 *   2. Truncate to a model-friendly length (Qwen 3 has plenty of
 *      context, but billed input still adds up — most novels' opening
 *      30-40K chars are enough for a name/description/tags pass).
 *   3. Hand off to Qwen via Vercel AI SDK's official `@ai-sdk/alibaba`
 *      provider with a Zod schema so the output is always shape-valid;
 *      the response is validated locally before it is returned.
 *
 * Endpoint config:
 *   - ALIBABA_API_KEY     — DashScope API key. This project standardizes
 *                           on this env name across server + agent.
 *
 * Model is hard-coded to `qwen-plus`. Previously this was an `AI_MODEL`
 * env var, but the name was misleadingly generic — ops set it to
 * `deepseek-chat` (a DeepSeek-native id DashScope rejects) and broke
 * /aurora/spark/analyze in prod. If we ever need a different model
 * here, change the literal, not a deploy-time knob.
 *
 * No DB writes, no external state. The dialog calls /project/update
 * separately once the user accepts.
 */

import { randomBytes } from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject } from 'ai';
import { z } from 'zod';
import mammoth from 'mammoth';
import Redis from 'ioredis';
// pdf-parse ships an `index.js` that runs a debug self-test on import,
// reading a fixture file from disk. The deep import below skips that.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/** Subset of `SparkUpload` the service actually reads. Defined
 *  locally to avoid pulling in `@types/multer` just for this one shape. */
export interface SparkUpload {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
  size?: number;
}

const MAX_INPUT_CHARS = 40_000;
const ATTACHMENT_TTL_SEC = 6 * 3600;

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const TAG_MAX_LEN = 20;
const TAGS_MAX = 5;
const BANNER_PROMPT_MAX = 800;
const parsePdf = pdfParse as unknown as (
  buffer: Buffer,
) => Promise<{ text?: string }>;

/**
 * Loose schema by design: only structural shape (string / array of
 * strings) is enforced at the model layer. Length / count caps are
 * applied as a post-processing step so a slightly-too-long answer
 * doesn't blow up the entire request — Qwen routinely overruns hard
 * `.max()` bounds, and `generateObject` will throw "did not match
 * schema" rather than truncate. Trade strictness here for resilience;
 * the dialog clamps display lengths as well.
 */
const SparkDraftSchema = z.object({
  name: z.string().min(1).describe('Concise project / IP name.'),
  description: z
    .string()
    .min(1)
    .describe(
      'One-paragraph tagline / synopsis. Hook the reader; leave the long-form story out.',
    ),
  tags: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Genre / mood / theme tags. Free-form short strings, no hashtag prefix.',
    ),
  bannerPrompt: z
    .string()
    .min(1)
    .describe(
      'A vivid English text-to-image prompt the platform will feed to ' +
        'an image model to generate a 16:9 promotional banner. Describe ' +
        'subject, environment, lighting, mood, art style — never ' +
        'narrative spoilers, no on-image text, no logos, no watermarks.',
    ),
  // Structural breakdown — these are *estimates* the StoryOS UI shows
  // before the full pipeline runs. They're allowed to be omitted if the
  // brief truly doesn't support a guess. All counts are positive ints;
  // language is a short label ("Chinese", "English", "Japanese", …);
  // runtimeMinutes is the *total* drama runtime, not per-episode.
  episodeCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Estimated number of episodes the brief would split into for a short-drama production (typically 8–24).',
    ),
  runtimeMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Estimated total runtime of the finished drama in minutes (sum of all episodes).',
    ),
  language: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Primary language of the source text as a short label (e.g. "Chinese", "English"). One word, capitalized.',
    ),
  roleCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Estimated number of distinct on-screen characters (including major + supporting roles).',
    ),
  sceneCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Estimated number of distinct scenes / locations the production would need.',
    ),
  propCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Estimated number of distinct props (objects characters interact with) the production would need.',
    ),
});

type SparkModelDraft = z.infer<typeof SparkDraftSchema>;

export type SparkDraft = SparkModelDraft & {
  /** Redis attachment ref containing the full extracted source text. */
  textRef?: string;
  sourceChars?: number;
  sourceExcerpt?: string;
};

let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  redisClient = url ? new Redis(url) : new Redis();
  redisClient.on('error', (err) => {
    console.error('[spark redis]', err?.message ?? err);
  });
  return redisClient;
}

function newAttachmentRef(): string {
  return `att_${randomBytes(6).toString('hex')}`;
}

@Injectable()
export class SparkService {
  private readonly logger = new Logger(SparkService.name);

  async analyzeUpload(file: SparkUpload): Promise<SparkDraft> {
    const text = await this.extractText(file);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'Could not read any text from the uploaded file.',
      );
    }
    const textRef = await this.cacheSourceText(trimmed, {
      filename: file.originalname,
      mimeType: file.mimetype,
    });
    const input = trimmed.slice(0, MAX_INPUT_CHARS);

    const apiKey = process.env.ALIBABA_API_KEY;
    if (!apiKey) {
      this.logger.error('ALIBABA_API_KEY not configured');
      throw new BadRequestException('AI provider is not configured.');
    }

    // Provider knows the DashScope endpoint; baseURL is only needed
    // when overriding (e.g. dashscope-intl for the .com region).
    const alibaba = createAlibaba({
      apiKey,
      ...(process.env.ALIBABA_BASE_URL
        ? { baseURL: process.env.ALIBABA_BASE_URL }
        : {}),
    });

    const { object } = await generateObject({
      model: alibaba('qwen-plus'),
      output: 'no-schema',
      providerOptions: { alibaba: { enableThinking: false } },
      abortSignal: AbortSignal.timeout(120_000),
      maxRetries: 3,
      system: [
        'You analyze a novel, screenplay, or pitch document and propose',
        'metadata for a creator-platform IP entry. Be specific to the',
        'material — generic answers are useless. Return exactly the',
        'JSON object the schema requires; do not add commentary.',
        JSON.stringify(z.toJSONSchema(SparkDraftSchema)),
        '',
        'Length budget (treat as soft caps; aim under, but never refuse):',
        `  - name:         up to ${NAME_MAX} characters, ideally 4-30.`,
        `  - description:  up to ${DESCRIPTION_MAX} characters, single paragraph.`,
        `  - tags:         ${TAGS_MAX} or fewer, each ≤ ${TAG_MAX_LEN} characters.`,
        `  - bannerPrompt: up to ${BANNER_PROMPT_MAX} characters.`,
        '',
        'Structural estimates (episodeCount / runtimeMinutes / roleCount /',
        'sceneCount / propCount / language) describe what a short-drama',
        'production of this brief would look like. Reason from cues in the',
        'text (number of named characters, distinct locations, plot beats',
        'per chapter, total length). When the brief is too thin to support',
        'an honest estimate, omit the field rather than inventing a number.',
        'Typical ranges: 8–24 episodes, 60–240 total runtime minutes,',
        '4–30 roles, 8–60 scenes, 5–40 props.',
        '',
        'Language rules:',
        '  - name / description / tags MUST match the source text language',
        '    (Chinese in → Chinese out).',
        '  - bannerPrompt MUST be in English regardless of source language —',
        '    image models follow English prompts more reliably.',
        '  - language: a short capitalized English label of the source text',
        '    language (e.g. "Chinese", "English", "Japanese") — NOT the',
        '    output language; this names what was uploaded.',
      ].join('\n'),
      prompt: `Source text:\n\n${input}\n\nReturn { name, description, tags, bannerPrompt, episodeCount, runtimeMinutes, language, roleCount, sceneCount, propCount } as JSON. Omit any structural field you cannot honestly estimate.`,
    });

    return {
      ...this.clamp(SparkDraftSchema.parse(object)),
      textRef,
      sourceChars: trimmed.length,
      sourceExcerpt: trimmed.slice(0, 800),
    };
  }

  /** Apply length caps in code so a slightly-overrun model response
   *  still ships. The dialog can show the (now-conformant) suggestion
   *  and the user is free to edit before applying. Structural counts
   *  are clamped to plausible upper bounds — the model occasionally
   *  hallucinates 4-digit numbers from a multi-novel anthology. */
  private clamp(draft: SparkModelDraft): SparkModelDraft {
    const clampInt = (v: number | undefined, max: number) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0
        ? Math.min(Math.round(v), max)
        : undefined;
    return {
      name: draft.name.trim().slice(0, NAME_MAX),
      description: draft.description.trim().slice(0, DESCRIPTION_MAX),
      tags: draft.tags
        .map((t) => t.trim().replace(/^#+/, '').slice(0, TAG_MAX_LEN))
        .filter(Boolean)
        .slice(0, TAGS_MAX),
      bannerPrompt: draft.bannerPrompt.trim().slice(0, BANNER_PROMPT_MAX),
      episodeCount: clampInt(draft.episodeCount, 200),
      runtimeMinutes: clampInt(draft.runtimeMinutes, 6000),
      language: draft.language?.trim().slice(0, 24) || undefined,
      roleCount: clampInt(draft.roleCount, 200),
      sceneCount: clampInt(draft.sceneCount, 500),
      propCount: clampInt(draft.propCount, 500),
    };
  }

  /**
   * Public-from-package equivalents of the private helpers — the
   * produce-proxy controller's multipart `step1/generate-from-file`
   * endpoint reuses both: extract the raw text out of the upload,
   * push it into Redis under `att_xxx`, and hand the textRef to the
   * step1 workflow. No LLM-based "insights" pass, since the produce
   * flow already has the project's name / description.
   */
  async extractAndCacheUpload(file: SparkUpload): Promise<{
    textRef: string;
    text: string;
    excerpt: string;
  }> {
    const text = await this.extractText(file);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'Could not read any text from the uploaded file.',
      );
    }
    const textRef = await this.cacheSourceText(trimmed, {
      filename: file.originalname,
      mimeType: file.mimetype,
    });
    return {
      textRef,
      text: trimmed,
      excerpt: trimmed.slice(0, 800),
    };
  }

  private async cacheSourceText(
    text: string,
    meta: { filename?: string; mimeType?: string },
  ): Promise<string> {
    const ref = newAttachmentRef();
    const payload = JSON.stringify({
      text,
      filename: meta.filename,
      mimeType: meta.mimeType,
      chars: text.length,
      cachedAt: Date.now(),
    });
    await getRedis().set(
      `attachment:${ref}`,
      payload,
      'EX',
      ATTACHMENT_TTL_SEC,
    );
    return ref;
  }

  private async extractText(file: SparkUpload): Promise<string> {
    const name = (file.originalname ?? '').toLowerCase();
    const mime = file.mimetype ?? '';

    // PDFs
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      const result = await parsePdf(file.buffer);
      return result.text ?? '';
    }

    // DOCX (modern Word). Old .doc binaries are not supported here —
    // mammoth refuses them and we'd rather 4xx than silently mis-parse.
    if (
      mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value ?? '';
    }
    if (mime === 'application/msword' || name.endsWith('.doc')) {
      throw new BadRequestException(
        'Legacy .doc files are not supported. Save as .docx and try again.',
      );
    }

    // Treat everything else as UTF-8 text. Covers .txt, .md, and the
    // common case where users drag in source files of unknown mime.
    return file.buffer.toString('utf-8');
  }
}
