export const INTERACTIVE_FILM_SESSION_SCHEMA_VERSION = 1 as const;

export type SessionVariableValue = string | number | boolean | null;

export type QteAssistMode = "normal" | "extended" | "untimed";

export type PlaybackQuality = "high" | "reduced";

export type PlaybackSettings = {
  muted: boolean;
  captionsEnabled: boolean;
  dialogueBoost: boolean;
  subtitleScale: number;
  subtitleBackground: "none" | "soft" | "solid";
  quality: PlaybackQuality;
  qteAssistMode: QteAssistMode;
  reduceMotion: boolean;
  reduceCameraShake: boolean;
  panoramaInertia: boolean;
};

export type SessionHistoryEntry = {
  nodeId: string;
  choiceId?: string;
  transactionId?: string;
  enteredAt: string;
};

export type StableCheckpoint = {
  nodeId: string;
  historyIndex: number;
  savedAt: string;
};

export type PendingChoiceTransaction = {
  transactionId: string;
  nodeId: string;
  choiceId: string;
  actionId?: string;
  nextNodeId: string;
  committedAt: string;
};

export type SessionEffect =
  | { kind: "set_variable"; key: string; value: SessionVariableValue }
  | { kind: "increment_variable"; key: string; amount: number }
  | { kind: "set_flag"; flag: string; value: boolean }
  | { kind: "adjust_relationship"; characterId: string; amount: number }
  | { kind: "mark_asset_watched"; assetId: string }
  | { kind: "unlock_ending"; endingId: string };

export type GameSession<TProfile> = {
  schemaVersion: typeof INTERACTIVE_FILM_SESSION_SCHEMA_VERSION;
  sessionId: string;
  gameId: string;
  releaseId: string;
  contentVersion: string;
  profile: TProfile;
  currentNodeId: string;
  variables: Record<string, SessionVariableValue>;
  flags: Record<string, boolean>;
  relationships: Record<string, number>;
  history: SessionHistoryEntry[];
  watchedAssets: string[];
  unlockedEndings: string[];
  settings: PlaybackSettings;
  stableCheckpoint: StableCheckpoint;
  pendingChoice: PendingChoiceTransaction | null;
  appliedTransactionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateGameSessionInput<TProfile> = {
  sessionId: string;
  gameId: string;
  releaseId: string;
  contentVersion: string;
  profile: TProfile;
  startNodeId: string;
  now: string;
  settings?: Partial<PlaybackSettings>;
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  muted: false,
  captionsEnabled: true,
  dialogueBoost: false,
  subtitleScale: 1,
  subtitleBackground: "soft",
  quality: "high",
  qteAssistMode: "normal",
  reduceMotion: false,
  reduceCameraShake: false,
  panoramaInertia: true,
};

function requireStableId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty stable id`);
  }
  return normalized;
}

export function createGameSession<TProfile>(
  input: CreateGameSessionInput<TProfile>
): GameSession<TProfile> {
  const sessionId = requireStableId(input.sessionId, "sessionId");
  const gameId = requireStableId(input.gameId, "gameId");
  const releaseId = requireStableId(input.releaseId, "releaseId");
  const contentVersion = requireStableId(input.contentVersion, "contentVersion");
  const startNodeId = requireStableId(input.startNodeId, "startNodeId");

  return {
    schemaVersion: INTERACTIVE_FILM_SESSION_SCHEMA_VERSION,
    sessionId,
    gameId,
    releaseId,
    contentVersion,
    profile: input.profile,
    currentNodeId: startNodeId,
    variables: {},
    flags: {},
    relationships: {},
    history: [{ nodeId: startNodeId, enteredAt: input.now }],
    watchedAssets: [],
    unlockedEndings: [],
    settings: { ...DEFAULT_PLAYBACK_SETTINGS, ...input.settings },
    stableCheckpoint: {
      nodeId: startNodeId,
      historyIndex: 0,
      savedAt: input.now,
    },
    pendingChoice: null,
    appliedTransactionIds: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}
