import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StoryProjectIdParamsSchema,
  StoryUuidSchema,
  type StoryProjectIdParams,
} from './dto';
import {
  StoryNarrativeSessionService,
  type StoryNarrativeSession,
} from './story-narrative-session.service';
import {
  DEFAULT_NARRATIVE_PACE,
  NARRATIVE_TURN_BUDGET_MS,
  StoryNarrativePaceSchema,
  StoryTextPlayService,
  StoryTextPlayTurnRequestSchema,
  type StoryNarrativeAction,
  type StoryTextPlayTurnRequest,
} from './story-text-play.service';

/** Java's gameId is our project id, but it travels as an opaque public token. */
const GameIdSchema = z.string().trim().min(1).max(160);
const ContentVersionSchema = z.string().trim().min(1).max(160);
const LocaleSchema = z.string().trim().min(2).max(32);

const NarrativeConceptsSchema = z
  .object({
    gameId: GameIdSchema,
    contentVersion: ContentVersionSchema,
    locale: LocaleSchema,
    count: z.number().int().min(3).max(6).default(6),
  })
  .strict();
type NarrativeConceptsBody = z.infer<typeof NarrativeConceptsSchema>;

const NarrativeEnterSchema = z
  .object({
    gameId: GameIdSchema,
    contentVersion: ContentVersionSchema,
    locale: LocaleSchema,
    // A run is pinned to the concept it was opened with, and `direction.id` is
    // how that pin is read back — an empty id would pin a run to nothing.
    selectedConceptId: z.string().trim().min(1).max(64),
    // Emptiness is a 422 INVALID_CONCEPT, not a field-shape 400 — the concept is
    // the payload the whole run is pinned to, so it gets its own answer.
    selectedConceptMarkdown: z.string().max(8_000),
  })
  .strict();
type NarrativeEnterBody = z.infer<typeof NarrativeEnterSchema>;

const NarrativeTurnsSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(128),
    action: z.enum(['start', 'continue', 'choice', 'free']),
    setup: z.object({ pace: StoryNarrativePaceSchema }).strict().optional(),
    // `choiceId` / `text` are action-conditional, so their requiredness is
    // enforced below as a 422 with the offending field named.
    choiceId: z.string().trim().max(128).optional(),
    text: z.string().trim().max(500).optional(),
  })
  .strict();
type NarrativeTurnsBody = z.infer<typeof NarrativeTurnsSchema>;

/**
 * Creator-side text-adventure 试玩 against the live draft.
 *
 * The PUBLIC runtime for a published text adventure lives in
 * `StoryTextExperienceController` below — same engine, frozen revision.
 */
@Controller('story-projects')
export class StoryTextPlayController {
  constructor(private readonly textPlay: StoryTextPlayService) {}

  @Post(':projectId/text-play/start')
  async start(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.textPlay.start(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
      ),
    };
  }

  @Post(':projectId/text-play/turn')
  async turn(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(StoryTextPlayTurnRequestSchema))
    body: StoryTextPlayTurnRequest,
  ) {
    return {
      code: 200,
      data: await this.textPlay.turn(
        user,
        requiredWorkspaceId(workspaceHeader),
        params.projectId,
        body,
      ),
    };
  }
}

/**
 * Public narrative runtime for a published text adventure.
 *
 * Three routes — concepts / enter / turns — mirroring the IP-direct narrative
 * API field for field, so one player client drives both: pick a concept, enter
 * to open a server-held run, then play it turn by turn. The engine state lives
 * in Redis behind the `sessionId`; the client sees prose and options only, and
 * can no longer edit, rewind or forge a run by hand.
 *
 * A confirmed publication is the anonymous read grant, so every route here
 * spends model tokens on an ANONYMOUS request and is rate limited per client
 * address. Concepts is the expensive, most abusable call (a full pitch set per
 * press of "reroll"), so it gets the tighter bucket.
 */
@Controller('story-experiences')
export class StoryTextExperienceController {
  constructor(
    private readonly textPlay: StoryTextPlayService,
    private readonly sessions: StoryNarrativeSessionService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * `scope` narrows the bucket below the address — the only caller that needs
   * it is `concepts`, which fires without any player action, so one story must
   * not be able to spend a shared address's budget for every other story.
   */
  private async guard(
    bucket: string,
    req: Request,
    max: number,
    windowSec: number,
    scope?: string,
  ): Promise<void> {
    const actor = requestActor(req);
    await this.rateLimit.guard({
      bucket: `text-play:${bucket}`,
      actorId: scope ? `${actor}#${scope}` : actor,
      max,
      windowSec,
    });
  }

  /** ⓪ The concepts a player picks between before entering. No session yet. */
  @Post('narrative/concepts')
  @Public()
  async concepts(
    @Req() req: Request,
    @Body(new ZodValidationPipe(NarrativeConceptsSchema))
    body: NarrativeConceptsBody,
  ) {
    // 12 batches per story per 15 minutes, per address. This call fires on
    // mount, so the budget has to cover a page load plus a real rerolling
    // session — but a shared address (an office, a campus, one Front Door POP
    // whose edge IP we fall back to) must not run out of concepts because one
    // player rerolled: the story id is part of the key, so exhausting it only
    // ever closes the door on rerolling THAT story. The cap stays low because
    // one press of reroll is one full pitch set of model tokens.
    await this.guard('concepts', req, 12, 900, body.gameId);
    return {
      code: 200,
      data: {
        gameId: body.gameId,
        items: await this.textPlay.publishedConcepts(
          body.gameId,
          body.contentVersion,
          body.locale,
          body.count,
        ),
      },
    };
  }

  /**
   * ① Open a run around the picked concept.
   *
   * `setupOptions` carries only `paces`: an authored story has no playable cast
   * to choose from, and the concept the player already picked IS the direction.
   */
  @Post('narrative/enter')
  @Public()
  async enter(
    @Req() req: Request,
    @Body(new ZodValidationPipe(NarrativeEnterSchema))
    body: NarrativeEnterBody,
  ) {
    await this.guard('enter', req, 30, 300);
    const entry = await this.textPlay.narrativeEnter({
      gameId: body.gameId,
      contentVersion: body.contentVersion,
      locale: body.locale,
      conceptId: body.selectedConceptId,
      conceptMarkdown: body.selectedConceptMarkdown,
    });
    const { sessionId } = await this.sessions.create({
      gameId: body.gameId,
      contentVersion: body.contentVersion,
      locale: body.locale,
      conceptId: body.selectedConceptId,
      conceptMarkdown: body.selectedConceptMarkdown.trim(),
      direction: entry.direction,
      pace: DEFAULT_NARRATIVE_PACE,
      runawayTurnGuard: this.textPlay.runawayTurnGuardForPace(
        DEFAULT_NARRATIVE_PACE,
      ),
    });
    return {
      code: 200,
      data: {
        sessionId,
        gameId: body.gameId,
        locale: body.locale,
        prologue: entry.prologue,
        // Every frozen track of this release, resolved once here so a turn's
        // cue can name a track by id alone.
        music: entry.music,
        setupOptions: {
          paces: this.textPlay.narrativePaceOptions(body.locale),
        },
        defaults: { pace: DEFAULT_NARRATIVE_PACE },
        // The longest a single turn may legally take. The client waits strictly
        // longer than this instead of picking its own number, because a client
        // timeout under the server's budget aborts the turn most worth keeping
        // (an ending narrates twice) while the server saves it anyway.
        turnBudgetMs: NARRATIVE_TURN_BUDGET_MS,
      },
    };
  }

  /** ② One turn of the run — the first one being `action: "start"`. */
  @Post('narrative/turns')
  @Public()
  async turns(
    @Req() req: Request,
    @Body(new ZodValidationPipe(NarrativeTurnsSchema))
    body: NarrativeTurnsBody,
  ) {
    await this.guard('turns', req, 60, 300);
    const action = narrativeAction(body);
    return {
      code: 200,
      data: await this.sessions.withSession(body.sessionId, async (session) => {
        assertActionAllowed(session, action);
        if (action.kind === 'start') {
          // Setup is submitted with the first turn, not at enter; the enter
          // defaults stand in when the player never touched the wizard.
          const pace = body.setup?.pace ?? session.pace;
          session.pace = pace;
          session.runawayTurnGuard =
            this.textPlay.runawayTurnGuardForPace(pace);
          session.started = true;
        }
        const result = await this.textPlay.playNarrativeTurn(session, action);
        if (result.finished) session.endedAt = Date.now();
        return result;
      }),
    };
  }
}

/**
 * Resolve the action, naming the missing field. The wire keeps `choiceId` and
 * `text` flat (mirroring the IP API) so requiredness is conditional on `action`
 * rather than expressible in the body schema.
 */
function narrativeAction(body: NarrativeTurnsBody): StoryNarrativeAction {
  if (body.action === 'choice') {
    if (!body.choiceId) {
      throw new UnprocessableEntityException({
        code: 'CHOICE_ID_REQUIRED',
        message: 'choiceId is required for a choice action.',
        fields: ['choiceId'],
      });
    }
    return { kind: 'choice', choiceId: body.choiceId };
  }
  if (body.action === 'free') {
    if (!body.text) {
      throw new UnprocessableEntityException({
        code: 'TEXT_REQUIRED',
        message: 'text is required for a free action.',
        fields: ['text'],
      });
    }
    return { kind: 'free', text: body.text };
  }
  return { kind: body.action };
}

/**
 * A run has exactly one opening and one close. Guessing what the player meant
 * would fork the story silently, so every violation is refused — but they are
 * NOT the same refusal, and the codes say so.
 *
 * INVALID_ACTION is reserved for the run that already reached its ending: the
 * SESSION is finished, so no retry of any action can ever succeed against it
 * and the client is right to throw it away. The other two describe a run that
 * is alive and playable, only out of step with the action that arrived —
 * reachable whenever a start answer is lost in flight (a stale lock 429s the
 * first press, the player presses again, and the first one lands). Collapsing
 * them into INVALID_ACTION costs the player a perfectly healthy started run.
 * An action the ENGINE refuses answers ACTION_NOT_ALLOWED, a third recoverable
 * case. See NARRATIVE_ERROR_CODES in story-text-play.service.ts.
 */
function assertActionAllowed(
  session: StoryNarrativeSession,
  action: StoryNarrativeAction,
): void {
  if (session.endedAt !== null) {
    throw new ConflictException({
      code: 'INVALID_ACTION',
      message: 'This run already reached its ending.',
    });
  }
  if (action.kind === 'start' && session.started) {
    throw new ConflictException({
      code: 'RUN_ALREADY_STARTED',
      message: 'This run has already started; continue it instead.',
    });
  }
  if (action.kind !== 'start' && !session.started) {
    throw new ConflictException({
      code: 'RUN_NOT_STARTED',
      message: 'This run has not started yet; start it first.',
    });
  }
}

/**
 * The rate-limit actor for an anonymous player.
 *
 * The rungs are ordered by which hop actually survives to us in each topology,
 * not by convenience:
 *
 * 1. `x-azure-clientip` — Azure Front Door's own note of the peer it accepted.
 *    On the Front Door hosts it is the ONLY surviving client identity:
 *    ingress-nginx runs without `use-forwarded-headers` /
 *    `compute-full-forwarded-for` (deploy/helm/cluster-bootstrap/
 *    ingress-nginx-values.yaml), so it OVERWRITES `x-forwarded-for` with
 *    `$remote_addr` — the edge IP. Keying on that chain would put every player
 *    behind one POP in a single bucket, and `concepts` fires on mount, so the
 *    visitors past the cap could not start a run at all. Its sibling
 *    `x-azure-clientip-country` is already consumed by CountryMiddleware, which
 *    is the proof these headers reach Nest.
 * 2. the first `x-forwarded-for` hop — the direct-LB host and `next dev` have
 *    no Front Door in front of them, and there the chain still begins at the
 *    browser. (Only here is the header caller-controlled, and spoofing it just
 *    splits the attacker's own bucket.)
 * 3. `req.ip` / the socket — no proxy at all: tests, curl straight at the pod.
 */
function requestActor(req: Request): string {
  const azureClientIp = req.header('x-azure-clientip')?.trim();
  const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    azureClientIp ||
    forwardedFor ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim();
  const parsed = StoryUuidSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: normalized
        ? 'WORKSPACE_HEADER_INVALID'
        : 'WORKSPACE_HEADER_REQUIRED',
      message: normalized
        ? 'x-fizz-workspace-id must be a valid UUID.'
        : 'x-fizz-workspace-id is required.',
    });
  }
  return parsed.data;
}
