/**
 * Shared types for the IP-direct narrative play PROTOTYPE (Next.js layer).
 *
 * This is the throwaway Next implementation of the enter/turns contract
 * (docs/narrative-runtime-java-api-v0.md). Java owns the real, persisted version;
 * here everything lives in process memory (no DB). See ./session-store.
 */

export type ActStage = "qi" | "cheng" | "zhuan" | "he";

/** Server-only per-session "story bible". Never sent to the client (spoilers). */
export interface Bible {
  genre: string;
  /** One-line hook: protagonist + core conflict + stakes. */
  logline?: string;
  /** Core conflict framed as want-vs-need. */
  coreConflict?: string;
  secretTruth: string;
  styleGuide: string;
  acts: Array<{
    stage: ActStage;
    anchor: string;
    /** Suggested number of key choices in this act. */
    density?: number;
    emotionArc: string;
    exitHook: string;
  }>;
  characters: Array<{
    id: string;
    name: string;
    role: string;
    playable: boolean;
    public: boolean;
    tagline: string;
    /** Hidden motive / secret. */
    secret?: string;
    llmBehavior: string;
  }>;
  clues: Array<{ id: string; title: string; detail: string; unlockHint: string }>;
  endings: Array<{ id: string; type: string; title: string; condition: string; review: string }>;
}

export interface PlaySetup {
  roleId?: string;
  directionKey?: string;
  pace?: string;
}

/** Server-only mutable session state. */
export interface LiveState {
  setup: PlaySetup | null;
  turnCount: number;
  stage: ActStage;
  unlockedClueIds: string[];
  recentTurns: Array<{ role: "player" | "narrator"; text: string }>;
  /** Last turn's suggested options, so a `choice` action can resolve id → label. */
  lastOptions: Array<{ id: string; label: string }>;
}

export interface Session {
  ipId: string;
  ipTitle: string;
  locale: string;
  bible: Bible;
  live: LiveState;
  createdAt: number;
  updatedAt: number;
}

// ── Client-facing shapes ──

export interface SetupOptions {
  roles: Array<{ id: string; name: string; role: string; tagline: string }>;
  directions: Array<{ key: string; label: string }>;
  paces: Array<{ key: string; label: string }>;
}

export interface EnterResponse {
  sessionId: string;
  ipId: string;
  title: string;
  prologue: string;
  setupOptions: SetupOptions;
  defaults: PlaySetup;
}

export type TurnAction = "start" | "continue" | "choice" | "free";

export interface TurnRequest {
  sessionId: string;
  action: TurnAction;
  setup?: PlaySetup;
  choiceId?: string;
  text?: string;
}

/** Minimal turn response (contract §4.2): render content + options + ended flag. */
export interface TurnResponse {
  narrative: string;
  options: Array<{ id: string; label: string }>;
  finished: boolean;
  stage: ActStage;
  turnCount: number;
}
