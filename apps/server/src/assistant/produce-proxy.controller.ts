import { requiredEnv } from '../common/required-env';
/**
 * Proxies /aurora/produce/* to Mastra's produce-mode routes.
 *
 * Produce mode is intentionally outside the StoryOS chat message stream:
 * Step 1 creates an ephemeral draft, and only /commit persists it.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth';
import { describeUnknown } from '../common/values';
import { SparkService, type SparkUpload } from '../spark/spark.service';
import { mastraFetch } from './mastra-fetch';
import { EntitlementService } from '../entitlements';

type JsonBody = Record<string, unknown>;

type ContextHeader = {
  userId: string;
  projectId: string;
  worldId?: string;
  locale?: string;
  dialogLanguage?: string;
};

@Controller('produce')
export class ProduceProxyController {
  private readonly logger = new Logger(ProduceProxyController.name);

  constructor(
    private readonly spark: SparkService,
    private readonly entitlements: EntitlementService,
  ) {}

  private get mastraUrl(): string {
    return requiredEnv('MASTRA_URL').replace(/\/$/, '');
  }

  private buildHeaders(
    req: Request,
    context: ContextHeader,
  ): Record<string, string> {
    const acceptLanguage = req.headers['accept-language'];
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'accept-language':
        (Array.isArray(acceptLanguage)
          ? acceptLanguage.join(',')
          : acceptLanguage) ?? 'zh-CN',
      'x-storyos-context': JSON.stringify(context),
    };
    const cookie = req.headers.cookie;
    if (cookie) headers.cookie = cookie;
    return headers;
  }

  private buildContext(user: AuthUser, body: JsonBody): ContextHeader {
    const seed =
      body.seed && typeof body.seed === 'object'
        ? (body.seed as Record<string, unknown>)
        : {};
    const projectId = scalarString(body.projectId) ?? '';
    const worldId = scalarString(body.worldId) ?? scalarString(seed.worldId);
    const language = scalarString(seed.language);
    return {
      userId: user.userId,
      projectId,
      worldId,
      dialogLanguage: language,
    };
  }

  private async forward<T = unknown>(
    path: string,
    req: Request,
    context: ContextHeader,
    body: JsonBody,
  ): Promise<T> {
    const url = `${this.mastraUrl}${path}`;
    const cookie = req.headers.cookie;
    if (cookie) {
      const satoken = /(?:^|;\s*)satoken=([^;]+)/.exec(cookie)?.[1];
      this.logger.log(
        `→ ${path} cookie=present token=${satoken?.slice(0, 8) ?? '(none)'}`,
      );
    } else {
      this.logger.warn(`→ ${path} cookie=MISSING`);
    }
    // Sit just above Mastra's 30-min server.timeout so Mastra's clean
    // 504 wins the race when the workflow truly overruns. Without an
    // explicit signal, Node's undici defaults `headersTimeout` to
    // 5 min and would false-fire on the long-poll well before Mastra
    // itself decides to give up.
    const FORWARD_TIMEOUT_MS = 31 * 60 * 1000;
    let upstream: globalThis.Response;
    const startedAt = Date.now();
    try {
      upstream = await mastraFetch(url, {
        method: 'POST',
        headers: this.buildHeaders(req, context),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = describeUnknown(err);
      this.logger.error(
        `← ${path} fetch FAILED after=${Date.now() - startedAt}ms reason=${msg}`,
      );
      throw new HttpException(
        { message: `Mastra unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }
    this.logger.log(
      `← ${path} status=${upstream.status} after=${Date.now() - startedAt}ms`,
    );
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      const code =
        upstream.status >= 400 && upstream.status < 500
          ? upstream.status
          : HttpStatus.BAD_GATEWAY;
      // Bumped from 400 → 6000 chars so Mastra's full failure dump
      // (including the failing step's name + thrown message) reaches
      // the browser's network tab. The dump is JSON-encoded inside
      // a JSON string so DevTools shows it but doesn't pretty-print
      // the inner shape — copy + pipe through a JSON pretty-printer
      // when triaging.
      throw new HttpException(
        { message: text.slice(0, 6000) || 'Mastra error' },
        code,
      );
    }
    return (await upstream.json()) as T;
  }

  // Synchronous run: blocks for ~30-120s while Mastra runs the
  // produce_script_pipeline in-process, then returns the draft.
  // Replaces the old start/status/cancel triplet — the frontend
  // simply awaits this single response. If the user closes the tab
  // / navigates away mid-flight, the abort propagates as a fetch
  // failure here and the caller-side socket close.
  @Post('script-draft/sync')
  async sync(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/sync', req, context, body);
  }

  @Post('script-draft/commit')
  async commit(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/commit', req, context, body);
  }

  @Post('script-draft/committed')
  async committed(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/committed', req, context, body);
  }

  // ─── Step 1 (episodes + scripts) ──────────────────────────────────
  // Mirrors `script-draft/sync` + `/commit` but runs the slimmer
  // `produce_step1_episodes` workflow that stops after scripts. Phase
  // A1 of the produce pipeline split — Step 2 (assets) and Step 3
  // (storyboard) follow with their own routes.
  @Post('step1/generate')
  async step1Generate(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/step1/generate', req, context, body);
  }

  @Post('step1/commit')
  async step1Commit(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/step1/commit', req, context, body);
  }

  // ─── Step 2: asset extraction ─────────────────────────────────────
  @Post('step2/generate')
  async step2Generate(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/step2/generate', req, context, body);
  }

  @Post('step2/commit')
  async step2Commit(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/step2/commit', req, context, body);
  }

  // ─── Step 1 multipart variant — single-shot upload + run ──────────
  //
  // The reseed flow doesn't need spark/analyze's LLM-based
  // name/description suggestions (the project already exists). We
  // skip that round-trip and pipe the file straight into Step 1:
  //   1. Extract text via SparkService (mammoth / pdf-parse, no LLM).
  //   2. Cache it in Redis under `att_xxx` for the workflow to read.
  //   3. Build the seed inline from the form fields the dropzone sent.
  //   4. Forward to the agent's JSON `/produce/step1/generate`.
  //
  // The browser issues exactly one POST and gets back `{runId, draft}`,
  // same envelope as the JSON variant — the page renders the draft
  // review card unchanged.
  @Post('step1/generate-from-file')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async step1GenerateFromFile(
    @UploadedFile() file: SparkUpload | undefined,
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Missing "file" field in upload.');
    }
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const worldId = scalarString(body.worldId);
    const worldName = scalarString(body.worldName) ?? '';
    const description = scalarString(body.description) ?? '';
    const language = scalarString(body.language);
    const episodeCountRaw = body.episodeCount;
    const episodeCount =
      typeof episodeCountRaw === 'number' && Number.isFinite(episodeCountRaw)
        ? episodeCountRaw
        : typeof episodeCountRaw === 'string' && /^\d+$/.test(episodeCountRaw)
          ? Number.parseInt(episodeCountRaw, 10)
          : undefined;

    // One-line diagnostic so we know whether the browser actually
    // forwarded a session cookie. Step 1's resolve_source throws
    // "Missing cookie in requestContext" when the agent gets no
    // cookie — the trail starts here.
    const cookieHint = req.headers.cookie
      ? `cookie=${String(req.headers.cookie).slice(0, 64)}…`
      : 'cookie=MISSING';
    this.logger.log(
      `step1 generate-from-file projectId=${projectId} fileSize=${file.size} ${cookieHint}`,
    );

    let extracted: { textRef: string; text: string; excerpt: string };
    try {
      extracted = await this.spark.extractAndCacheUpload(file);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`step1 extract failed: ${msg}`);
      throw new HttpException(
        { message: msg || 'Could not read uploaded file' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const seedPayload = {
      worldId,
      worldName,
      description,
      tags: [] as string[],
      episodeCount,
      language,
      sourceFile: {
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        path: '',
        textRef: extracted.textRef,
        chars: extracted.text.length,
        excerpt: extracted.excerpt,
      },
      createdAt: Date.now(),
    };

    const context = this.buildContext(user, { projectId, worldId });
    const forwardBody = { projectId, worldId, seed: seedPayload };
    return this.forward('/produce/step1/generate', req, context, forwardBody);
  }
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}
