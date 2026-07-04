/**
 * StoryGenerationService — S1 of the fizzstory-v3 staged pipeline
 * (docs/story-studio-creator-v3-refactor.md §D3): analyze the creator intake
 * into a StoryStudioAnalysis v2 (worldview + cast + clues + 起承转合 acts +
 * per-act plot beats), validate it, and persist the result into the project's
 * draft server-side so the stage is resumable and the client only has to
 * paint it.
 *
 * Validation is two-layered: lenient shape coercion, then strict semantic
 * checks whose violations drive ONE repair retry against the model.
 */
import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../auth';
import { PrismaService } from '../../infra/db/db.module';
import type { GenerateStoryAnalysisInput } from '../dto';
import { StoryProjectsService } from '../story-projects.service';
import {
  ACT_KEYS,
  GENERATOR_VERSION,
  genreOverviewTable,
  genreTemplateBlock,
  type StoryGenreKey,
} from './act-templates';
import {
  coerceAnalysisV2,
  validateAnalysisSemantics,
  type StoryStudioAnalysisV2,
} from './analysis-schema';
import { LlmOutputError, StoryLlmClient } from './llm-client';

export const DRAFT_SCHEMA_VERSION_V2 = 'story-studio-canvas-v2';

/** A takeover is allowed once a running stage looks abandoned. */
const RUNNING_STALE_MS = 5 * 60_000;

export interface GenerateAnalysisResult {
  analysis: StoryStudioAnalysisV2;
  draft: { revision: number; updatedAt: string };
  generator: { version: string; model: string; requestId: string };
}

export interface StartAnalysisResult {
  pipeline: { stage: 'analysis'; status: 'running'; startedAt: string };
  draft: { revision: number; updatedAt: string };
}

const ANALYSIS_JSON_SHAPE = {
  title: 'string',
  summary: 'string',
  worldview: 'string',
  storyKernel: 'string',
  adaptationDirection: 'string',
  genre:
    'suspense | two_hander | power_play | survival | coming_of_age | romance | tragedy | underdog | road_trip | detective',
  locations: ['string'],
  acts: [
    {
      key: 'setup | development | turn | resolution',
      anchor: 'string (剧情锚点)',
      emotionArc: 'string (情绪曲线)',
      exitHook: 'string (收口钩子)',
    },
  ],
  protagonist: { name: 'string', role: 'string', summary: 'string' },
  characters: [
    { name: 'string', role: 'string', summary: 'string', tags: ['string'] },
  ],
  clues: [
    {
      title: 'string',
      summary: 'string',
      type: 'string',
      source: 'string',
      use: 'string',
      rule: 'string',
      tags: ['string'],
    },
  ],
  plots: [
    {
      title: 'string',
      summary: 'string',
      entryGoal: 'string',
      actKey: 'setup | development | turn | resolution',
      tags: ['string'],
    },
  ],
  endings: [
    {
      title: 'string',
      type: 'truth | intervention | failure | hidden',
      summary: 'string',
      trigger: 'string',
      review: 'string',
      tags: ['string'],
    },
  ],
  guardrails: ['string'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class StoryGenerationService {
  private readonly logger = new Logger(StoryGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: StoryProjectsService,
    private readonly llm: StoryLlmClient,
  ) {}

  /**
   * ASYNC entry point: mark the pipeline `running` in the draft (revision
   * bump) and kick the model call off in the background — the HTTP response
   * returns immediately, well inside every proxy timeout. The client polls
   * the draft until `storySpec.pipeline.status` flips to done/error; a page
   * refresh resumes the same poll. A fresh `running` marker rejects
   * duplicate starts; a stale one (crashed run) may be taken over.
   */
  async startAnalysis(
    user: AuthUser,
    projectId: string,
    input: GenerateStoryAnalysisInput,
  ): Promise<StartAnalysisResult> {
    await this.projects.requireOwnProject(user, projectId);

    const startedAt = new Date().toISOString();
    const marker = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      });
      if (!draft) return null;

      const existing = isRecord(draft.content) ? draft.content : {};
      const spec = isRecord(existing.storySpec) ? existing.storySpec : {};
      const pipeline = isRecord(spec.pipeline) ? spec.pipeline : {};
      if (pipeline.status === 'running') {
        const runningSince =
          typeof pipeline.startedAt === 'string'
            ? Date.parse(pipeline.startedAt)
            : NaN;
        if (
          Number.isFinite(runningSince) &&
          Date.now() - runningSince < RUNNING_STALE_MS
        ) {
          throw new ConflictException({
            code: 'GENERATION_IN_PROGRESS',
            message: 'StoryOS is already generating this story.',
            startedAt: pipeline.startedAt,
          });
        }
      }

      const nextContent = {
        ...existing,
        storySpec: {
          ...spec,
          specVersion: 'fizzstory-v3',
          pipeline: { stage: 'analysis', status: 'running', startedAt },
        },
      };
      const claimed = await tx.storyDraft.updateMany({
        where: { storyProjectId: projectId, revision: draft.revision },
        data: {
          content: nextContent as Prisma.InputJsonObject,
          revision: { increment: 1 },
          updatedBySessionId: input.sessionId ?? 'storyos-generation',
          updatedByUserId: user.userId,
        },
      });
      if (claimed.count !== 1) return null;
      return { revision: draft.revision + 1, updatedAt: startedAt };
    });

    if (!marker) {
      throw new ConflictException({
        code: 'DRAFT_REVISION_CONFLICT',
        message:
          'The draft changed while starting generation — retry from the editor.',
      });
    }

    // Fire the actual model run detached from the request lifecycle. Every
    // outcome — success or failure — is persisted into the draft's pipeline
    // state; nothing is lost with the HTTP connection.
    void this.executeAnalysis(user, projectId, input).catch(
      async (error: unknown) => {
        const message =
          error instanceof Error
            ? ((error as { response?: { message?: string } }).response
                ?.message ?? error.message)
            : 'Story generation failed.';
        this.logger.error(`analysis run failed for ${projectId}: ${message}`);
        await this.persistPipelineError(projectId, message).catch(() => {});
      },
    );

    return {
      pipeline: { stage: 'analysis', status: 'running', startedAt },
      draft: marker,
    };
  }

  /** The synchronous model run — used by the async starter and by tests. */
  async executeAnalysis(
    user: AuthUser,
    projectId: string,
    input: GenerateStoryAnalysisInput,
  ): Promise<GenerateAnalysisResult> {
    await this.projects.requireOwnProject(user, projectId);

    const system = this.systemPrompt(input.locale, input.genre);
    const userMessage = JSON.stringify({
      prompt: input.prompt ?? null,
      uploadedFileName: input.uploadedFileName ?? null,
      uploadedContent: input.uploadedContent
        ? input.uploadedContent.slice(0, 60_000)
        : null,
    });
    const fallbackTitle = this.fallbackTitle(input.prompt);

    // Attempt 1 + ONE semantic repair retry.
    const first = await this.llm.completeJson({
      system,
      user: userMessage,
      maxTokens: 3200,
    });
    let analysis = coerceAnalysisV2(first.json, fallbackTitle);
    let violations = validateAnalysisSemantics(analysis);
    let requestId = first.requestId;

    if (violations.length > 0) {
      this.logger.warn(
        `analysis semantic violations (repairing) requestId=${first.requestId}: ${violations.join(' | ')}`,
      );
      try {
        const repaired = await this.llm.completeJson({
          system,
          user: [
            'Your previous JSON violated structural requirements. Fix ONLY the violations and return the FULL corrected JSON object.',
            `Violations:\n- ${violations.join('\n- ')}`,
            `Previous JSON:\n${JSON.stringify(first.json)}`,
          ].join('\n\n'),
          maxTokens: 3200,
          temperature: 0.2,
        });
        analysis = coerceAnalysisV2(repaired.json, fallbackTitle);
        violations = validateAnalysisSemantics(analysis);
        requestId = repaired.requestId;
      } catch (error) {
        if (!(error instanceof LlmOutputError)) throw error;
        // Repair produced garbage — fall through with the original violations.
      }
    }

    if (violations.length > 0) {
      throw new UnprocessableEntityException({
        code: 'STORY_ANALYSIS_INVALID',
        message: 'StoryOS could not produce a structurally valid act plan.',
        errors: violations,
      });
    }

    const generator = {
      version: GENERATOR_VERSION,
      model: first.model,
      requestId,
    };
    const draft = await this.persistAnalysis(
      user,
      projectId,
      analysis,
      generator,
      input.sessionId,
    );
    return { analysis, draft, generator };
  }

  /**
   * Server-side stage persistence: merge the analysis into the draft content
   * (CAS against the currently stored revision) and write the display
   * metadata through to the project row — same R1/R2 semantics as putDraft.
   */
  private async persistAnalysis(
    user: AuthUser,
    projectId: string,
    analysis: StoryStudioAnalysisV2,
    generator: { version: string; model: string; requestId: string },
    sessionId?: string,
  ): Promise<{ revision: number; updatedAt: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      });
      if (!draft) return null;

      const existing = isRecord(draft.content) ? draft.content : {};
      const nextContent = {
        ...existing,
        schemaVersion: DRAFT_SCHEMA_VERSION_V2,
        title: analysis.title,
        summary: analysis.summary,
        storyAnalysis: analysis as unknown as Record<string, unknown>,
        storySpec: {
          specVersion: 'fizzstory-v3',
          genre: analysis.genre,
          generator: { ...generator, generatedAt: new Date().toISOString() },
          pipeline: { stage: 'analysis', status: 'done' },
        },
        canvas: isRecord(existing.canvas)
          ? existing.canvas
          : { nodes: [], edges: [] },
      };

      const claimed = await tx.storyDraft.updateMany({
        where: { storyProjectId: projectId, revision: draft.revision },
        data: {
          content: nextContent as Prisma.InputJsonObject,
          schemaVersion: DRAFT_SCHEMA_VERSION_V2,
          revision: { increment: 1 },
          updatedBySessionId: sessionId ?? 'storyos-generation',
          updatedByUserId: user.userId,
        },
      });
      if (claimed.count !== 1) return null;

      const project = await tx.storyProject.update({
        where: { id: projectId },
        data: {
          title: analysis.title.slice(0, 160),
          summary: analysis.summary || null,
          version: { increment: 1 },
        },
        select: { updatedAt: true },
      });
      return {
        revision: draft.revision + 1,
        updatedAt: project.updatedAt.toISOString(),
      };
    });

    if (!result) {
      throw new ConflictException({
        code: 'DRAFT_REVISION_CONFLICT',
        message:
          'The draft changed while StoryOS was generating — retry from the editor.',
      });
    }
    return result;
  }

  /** Failure terminal state — the poller surfaces `pipeline.error` to the creator. */
  private async persistPipelineError(
    projectId: string,
    message: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const draft = await tx.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      });
      if (!draft) return;
      const existing = isRecord(draft.content) ? draft.content : {};
      const spec = isRecord(existing.storySpec) ? existing.storySpec : {};
      const nextContent = {
        ...existing,
        storySpec: {
          ...spec,
          pipeline: {
            stage: 'analysis',
            status: 'error',
            error: message.slice(0, 500),
            failedAt: new Date().toISOString(),
          },
        },
      };
      await tx.storyDraft.updateMany({
        where: { storyProjectId: projectId, revision: draft.revision },
        data: {
          content: nextContent as Prisma.InputJsonObject,
          revision: { increment: 1 },
          updatedBySessionId: 'storyos-generation',
        },
      });
    });
  }

  private systemPrompt(locale: string, genre?: StoryGenreKey): string {
    const outputLanguage = locale.toLowerCase().startsWith('zh')
      ? 'Chinese'
      : 'English';
    const templateBlock = genre
      ? [
          'Follow this 起承转合 genre template EXACTLY (per-act spec):',
          genreTemplateBlock(genre),
          `Set "genre" to "${genre}".`,
        ]
      : [
          "First pick the single best-fitting genre from this 起承转合 overview table, then design the acts in that genre's spirit:",
          genreOverviewTable(),
        ];

    return [
      'You are StoryOS, an expert narrative-system designer for playable AI text games.',
      `Return JSON only. Write all human-readable fields in ${outputLanguage}.`,
      'Analyze the creator intake into a first real canvas structure, not a marketing summary.',
      'The output becomes React Flow cards: one story root, character cards, global clue cards, plot-beat cards (ordered by their 起承转合 act), and ending cards.',
      'Design for player-led text interaction: the player can continue, enter open actions, and occasionally choose AI-suggested action points.',
      'Clues are a global evidence/state pool. Plot beats can require or unlock clues, but clues must not be treated as known before discovery.',
      ...templateBlock,
      'STRUCTURAL REQUIREMENTS (hard):',
      `- "acts" must contain EXACTLY 4 entries with keys ${ACT_KEYS.join(', ')} in that order (起/承/转/合).`,
      '- every plot beat carries "actKey" and every act owns at least one beat; 4-8 beats total.',
      '- the FIRST setup beat is the golden opening: it must carry the most attractive player choices.',
      'Return concise fields. Avoid long essays. Do not include markdown.',
      'Use this exact JSON shape:',
      JSON.stringify(ANALYSIS_JSON_SHAPE, null, 2),
    ].join('\n');
  }

  private fallbackTitle(prompt?: string): string {
    const trimmed = prompt?.trim() ?? '';
    if (!trimmed) return 'Untitled Story';
    return trimmed.length > 56 ? `${trimmed.slice(0, 56).trim()}...` : trimmed;
  }
}
