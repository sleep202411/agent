/**
 * Spark — analyzes a novel/script upload and proposes IP metadata.
 *
 *   1. Extract plain text from the upload (PDF / DOCX / TXT / MD).
 *   2. Truncate to a model-friendly length (Qwen 3 has plenty of
 *      context, but billed input still adds up — most novels' opening
 *      30-40K chars are enough for a name/description/tags pass).
 *   3. Hand off to Qwen via Vercel AI SDK's official `@ai-sdk/alibaba`
 *      provider with a Zod schema so the output is always shape-valid;
 *      SDK auto-retries on schema failure.
 *
 * Endpoint config:
 *   - ALIBABA_API_KEY     — DashScope API key (provider auto-reads
 *                           `DASHSCOPE_API_KEY` too; we pass the
 *                           value explicitly so the env name doesn't
 *                           silently drift).
 *
 * Model is hard-coded to `qwen3-max`. Previously this was an `AI_MODEL`
 * env var, but the name was misleadingly generic — ops set it to
 * `deepseek-chat` (a DeepSeek-native id DashScope rejects) and broke
 * /aurora/spark/analyze in prod. If we ever need a different model
 * here, change the literal, not a deploy-time knob.
 *
 * No DB writes, no external state. The dialog calls /project/update
 * separately once the user accepts.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject } from 'ai';
import { z } from 'zod';
import mammoth from 'mammoth';
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

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const TAG_MAX_LEN = 20;
const TAGS_MAX = 5;
const BANNER_PROMPT_MAX = 800;

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
});

export type SparkDraft = z.infer<typeof SparkDraftSchema>;

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
      model: alibaba('qwen3-max'),
      schema: SparkDraftSchema,
      schemaName: 'SparkDraft',
      schemaDescription:
        'Structured IP metadata derived from the supplied novel or screenplay text.',
      maxRetries: 3,
      system: [
        'You analyze a novel, screenplay, or pitch document and propose',
        'metadata for a creator-platform IP entry. Be specific to the',
        'material — generic answers are useless. Return exactly the',
        'JSON object the schema requires; do not add commentary.',
        '',
        'Length budget (treat as soft caps; aim under, but never refuse):',
        `  - name:         up to ${NAME_MAX} characters, ideally 4-30.`,
        `  - description:  up to ${DESCRIPTION_MAX} characters, single paragraph.`,
        `  - tags:         ${TAGS_MAX} or fewer, each ≤ ${TAG_MAX_LEN} characters.`,
        `  - bannerPrompt: up to ${BANNER_PROMPT_MAX} characters.`,
        '',
        'Language rules:',
        '  - name / description / tags MUST match the source text language',
        '    (Chinese in → Chinese out).',
        '  - bannerPrompt MUST be in English regardless of source language —',
        '    image models follow English prompts more reliably.',
      ].join('\n'),
      prompt: `Source text:\n\n${input}\n\nReturn { name, description, tags, bannerPrompt } as JSON.`,
    });

    return this.clamp(object);
  }

  /** Apply length caps in code so a slightly-overrun model response
   *  still ships. The dialog can show the (now-conformant) suggestion
   *  and the user is free to edit before applying. */
  private clamp(draft: SparkDraft): SparkDraft {
    return {
      name: draft.name.trim().slice(0, NAME_MAX),
      description: draft.description.trim().slice(0, DESCRIPTION_MAX),
      tags: draft.tags
        .map((t) => t.trim().replace(/^#+/, '').slice(0, TAG_MAX_LEN))
        .filter(Boolean)
        .slice(0, TAGS_MAX),
      bannerPrompt: draft.bannerPrompt.trim().slice(0, BANNER_PROMPT_MAX),
    };
  }

  private async extractText(file: SparkUpload): Promise<string> {
    const name = (file.originalname ?? '').toLowerCase();
    const mime = file.mimetype ?? '';

    // PDFs
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      const result = await pdfParse(file.buffer);
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
