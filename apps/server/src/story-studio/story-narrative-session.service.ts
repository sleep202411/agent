import {
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { z } from 'zod';
import { newShortId } from '../common/id';
import { REDIS } from '../infra/redis/redis.module';
import {
  NARRATIVE_TURN_BUDGET_MS,
  StoryNarrativePaceSchema,
  StoryTextPlayDirectionSchema,
  StoryTextPlayStateSchema,
  type StoryNarrativePace,
  type StoryTextPlayDirection,
} from './story-text-play.service';

/**
 * Server-held sessions for the public narrative runtime.
 *
 * The play state used to travel in the request body, which let a player rewind,
 * fork or forge a run by editing JSON — and forced every turn to re-send a
 * growing transcript. The session now lives here and the client only carries an
 * opaque `sessionId`; the engine state never leaves the server again.
 *
 * Redis (not Postgres) because a run is disposable: it expires 2 hours after
 * the last turn, nothing downstream reads it, and losing one costs a replay.
 */

const SESSION_KEY_PREFIX = 'story-narrative:session:';
/** Idle TTL, refreshed on every write — a run only dies when the player stops. */
const SESSION_TTL_SEC = 2 * 60 * 60;
/**
 * The lock has to outlive one turn — the WORST one, not the typical one.
 *
 * It is derived from the engine's own budget rather than hand-picked: a turn
 * that reaches an ending makes two sequential model calls, so a number chosen
 * to cover a single narration expires mid-turn, lets a second turn load the
 * pre-turn snapshot, and the two then save over each other — precisely the
 * interleaving this lock exists to prevent.
 */
const TURN_LOCK_TTL_SEC = Math.ceil(NARRATIVE_TURN_BUDGET_MS / 1_000);

/** Compare-and-delete so a lock that already expired is never stolen back. */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export const StoryNarrativeSessionSchema = z
  .object({
    gameId: z.string().max(160),
    contentVersion: z.string().max(160),
    locale: z.string().max(32),
    conceptId: z.string().max(64),
    conceptMarkdown: z.string().max(8_000),
    direction: StoryTextPlayDirectionSchema.nullable(),
    pace: StoryNarrativePaceSchema,
    /**
     * Runaway backstop for one beat, pinned at start so a mid-run pace change
     * cannot rewrite it. Not a pacing knob: the narrator's `converged` decides
     * arrival, and normal play never reaches this number.
     */
    runawayTurnGuard: z.number().int().min(1).max(40),
    /** The first beat is produced by `turns(action:"start")`, not by `enter`. */
    started: z.boolean(),
    /**
     * The track currently playing, so a turn only cues music when it actually
     * changes. Absent in a run opened before the story had music, which reads
     * as exactly what it was: nothing playing.
     */
    musicTrackId: z.string().max(160).nullable().default(null),
    play: StoryTextPlayStateSchema,
    endedAt: z.number().nullable(),
    createdAt: z.number(),
  })
  .strict();
export type StoryNarrativeSession = z.infer<typeof StoryNarrativeSessionSchema>;

export interface StoryNarrativeSessionSeed {
  gameId: string;
  contentVersion: string;
  locale: string;
  conceptId: string;
  conceptMarkdown: string;
  direction: StoryTextPlayDirection;
  pace: StoryNarrativePace;
  runawayTurnGuard: number;
}

@Injectable()
export class StoryNarrativeSessionService {
  private readonly logger = new Logger(StoryNarrativeSessionService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Pin the picked concept into a fresh run. No story prose exists yet. */
  async create(
    seed: StoryNarrativeSessionSeed,
  ): Promise<{ sessionId: string; session: StoryNarrativeSession }> {
    const sessionId = `sess_${newShortId()}`;
    const session: StoryNarrativeSession = {
      ...seed,
      started: false,
      musicTrackId: null,
      // The engine owns `play` from `start` onwards; until then it is just the
      // pinned direction waiting for an entry node.
      play: {
        nodeId: null,
        direction: seed.direction,
        freeTurnsUsed: 0,
        transcript: [],
      },
      endedAt: null,
      createdAt: Date.now(),
    };
    await this.save(sessionId, session);
    return { sessionId, session };
  }

  /**
   * A run that expired, was never created, or predates a shape change reads the
   * same to the player: start over. Never resurrect a partially-decodable run —
   * the engine would narrate from a state it cannot trust.
   */
  async get(sessionId: string): Promise<StoryNarrativeSession> {
    const raw = await this.redis.get(sessionKey(sessionId));
    if (!raw) throw sessionExpired();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw sessionExpired();
    }
    const session = StoryNarrativeSessionSchema.safeParse(parsed);
    if (!session.success) throw sessionExpired();
    return session.data;
  }

  async save(sessionId: string, session: StoryNarrativeSession): Promise<void> {
    await this.redis.set(
      sessionKey(sessionId),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SEC,
    );
  }

  /**
   * Load, mutate and persist one run under an exclusive lock.
   *
   * A turn spends model tokens and advances the graph, so two in-flight turns on
   * one session would interleave into a state neither player action produced. A
   * `SET NX` lock is preferred over an optimistic version field because the
   * loser of a version race would only discover the conflict AFTER paying for a
   * narration — this way it never starts one.
   *
   * The session is written only when the handler resolves: a failed turn leaves
   * the run exactly where it was, so the player can simply retry.
   */
  async withSession<T>(
    sessionId: string,
    handler: (session: StoryNarrativeSession) => Promise<T>,
  ): Promise<T> {
    const lockKey = `${sessionKey(sessionId)}:lock`;
    const token = newShortId();
    const acquired = await this.redis.set(
      lockKey,
      token,
      'EX',
      TURN_LOCK_TTL_SEC,
      'NX',
    );
    if (!acquired) {
      throw new HttpException(
        {
          code: 'TURN_IN_FLIGHT',
          message: 'This run is already playing a turn; wait for it to land.',
          retryable: true,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      const session = await this.get(sessionId);
      const result = await handler(session);
      await this.save(sessionId, session);
      return result;
    } finally {
      try {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
      } catch (error) {
        // Never let lock cleanup mask the turn's own outcome — the TTL collects
        // the lock anyway.
        this.logger.warn(
          `narrative.lock_release_failed session=${sessionId} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function sessionExpired(): GoneException {
  return new GoneException({
    code: 'SESSION_EXPIRED',
    message: 'This run has expired; start a new one.',
  });
}
