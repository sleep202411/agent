import type { StorageLike } from "@/src/features/interactive-film/persistence/repository";
import { LocalSessionRepository } from "@/src/features/interactive-film/persistence/local-repository";
import { createGameSession } from "@/src/features/interactive-film/domain/session";
import { createGameSessionSchema } from "@/src/features/interactive-film/domain/session-schema";
import {
  JinlingPlayerProfileSchema,
  keepsakeForJinlingProfile,
  type JinlingPlayerProfile,
} from "./player-profile";

export const JINLING_GAME_ID = "jinling-rumeng";
export const JINLING_RELEASE_ID = "season-01-production";
export const JINLING_CONTENT_VERSION = "2026.07.11.1";
export const JINLING_SEASON_ONE_START_NODE = "S01-SC01";

export const JinlingGameSessionSchema = createGameSessionSchema(JinlingPlayerProfileSchema);
export type JinlingGameSession = ReturnType<typeof JinlingGameSessionSchema.parse>;

export function createJinlingSessionRepository(storage?: StorageLike) {
  return new LocalSessionRepository<JinlingPlayerProfile>({
    gameId: JINLING_GAME_ID,
    releaseId: JINLING_RELEASE_ID,
    contentVersion: JINLING_CONTENT_VERSION,
    decodeSession: (input) => JinlingGameSessionSchema.parse(input),
    storage,
  });
}

export function createNewJinlingSession(input: {
  sessionId: string;
  profile: JinlingPlayerProfile;
  now: string;
}): JinlingGameSession {
  const profile = JinlingPlayerProfileSchema.parse(input.profile);
  const session = createGameSession({
    sessionId: input.sessionId,
    gameId: JINLING_GAME_ID,
    releaseId: JINLING_RELEASE_ID,
    contentVersion: JINLING_CONTENT_VERSION,
    profile,
    startNodeId: JINLING_SEASON_ONE_START_NODE,
    now: input.now,
  });

  return JinlingGameSessionSchema.parse({
    ...session,
    variables: {
      ledgerInsight: 1,
      keepsakeId: keepsakeForJinlingProfile(profile),
    },
    flags: {
      profileStamped: true,
    },
  });
}
