/**
 * Client fetchers for the published story-experience narrative runtime.
 *
 * Structural mirror of the IP-direct client (`play-api.ts`): the same error
 * class shape and the same "hard-fail on a malformed response" normalizers.
 * Timeouts differ in kind: concepts / enter are generative and get a flat
 * ceiling, while a turn waits on whatever budget the run itself declared.
 * The differences are the wire only — these endpoints live on our own NestJS
 * service under `/aurora/story-experiences/narrative/*` and answer with the
 * `{ code, data }` envelope, an authored story has no playable cast (so the
 * setup options carry pacing alone), and a turn option declares whether it is
 * an authored `choice` or a model-suggested free action.
 */

import type { Locale } from "@/src/i18n/config";

/**
 * A pace the player may pick. Key and label only: pace biases how quickly the
 * narrator escalates toward the next authored beat, and every pace narrates —
 * so there is nothing here for the client to gate an affordance on.
 */
export interface StoryPaceOption {
  key: string;
  label: string;
}

export interface StorySetupOptions {
  paces: StoryPaceOption[];
}

/**
 * One playable track referenced by the published manifest. `trackId` identifies
 * the file, so the same theme bound to several nodes is one track here. `url`
 * is an ordinary public media URL that stays valid for the whole run.
 */
export interface StoryMusicTrack {
  trackId: string;
  url: string;
  /** Authored bed level, 0..1. */
  gain: number;
}

/**
 * Every track this run can ever ask for, so the client can warm them before the
 * first cue. A story with no music answers `enabled: false` and an empty list —
 * the common case, and the one that must cost nothing.
 */
export interface StoryMusicConfig {
  enabled: boolean;
  tracks: StoryMusicTrack[];
}

/**
 * Emitted only when play ENTERS a node whose bound track differs from what is
 * already playing. Entering a node with no binding emits nothing at all — a
 * theme carries across scenes rather than being cut by every unscored beat,
 * and anchors are sparse, so most turns carry no cue.
 *
 * `play` is the only action: a run keeps its bed under the closing passage and
 * the decks are torn down when the run is left.
 */
export interface StoryMusicCue {
  action: "play";
  trackId: string;
  fadeMs: number;
}

export interface StoryConceptOption {
  id: string;
  contentMarkdown: string;
}

export interface StoryConceptsResult {
  gameId: string;
  items: StoryConceptOption[];
}

export interface StoryEnterResult {
  sessionId: string;
  gameId: string;
  locale: string;
  /** Atmospheric framing shown as the first setup step. Never a story turn. */
  prologue: string;
  setupOptions: StorySetupOptions;
  defaults: { pace?: string };
  /**
   * The longest one turn may legally take server-side. Every turn of this run
   * waits longer than this rather than picking a local number: a turn that
   * reaches an ending narrates twice, and a client timeout under that budget
   * aborts — and discards — the one turn a run cannot afford to lose.
   */
  turnBudgetMs: number;
  /** Always present after normalization; silent when the story has no music. */
  music: StoryMusicConfig;
}

/**
 * `choice` = an authored exit from the manifest graph (click replays it by id).
 * `suggestion` = a model-proposed free action (click sends its label as text).
 * Both render identically; a single turn never mixes the two.
 */
export type StoryOptionKind = "choice" | "suggestion";

export interface StoryTurnOption {
  id: string;
  label: string;
  kind: StoryOptionKind;
}

export interface StoryEnding {
  endingId: string;
  title: string;
  summary: string;
}

export interface StoryTurnResult {
  narrative: string;
  options: StoryTurnOption[];
  finished: boolean;
  ending?: StoryEnding;
  /** Absent means "no change" — the common case. */
  music?: StoryMusicCue;
}

export type StoryTurnAction = "start" | "continue" | "choice" | "free";

const BASE = "/aurora/story-experiences/narrative";
const CONCEPTS_ENDPOINT = `${BASE}/concepts`;
const ENTER_ENDPOINT = `${BASE}/enter`;
const TURNS_ENDPOINT = `${BASE}/turns`;
const CONCEPTS_TIMEOUT_MS = 180_000;
const ENTER_TIMEOUT_MS = 180_000;
/**
 * Added to the run's server-declared `turnBudgetMs` so the browser always waits
 * STRICTLY longer than the server may take — the slack covers the round trip and
 * the proxy hop the budget itself does not describe.
 */
const TURN_TIMEOUT_SLACK_MS = 20_000;
/** Sanity bounds on the declared budget: a nonsense number must not disarm the
 * abort altogether, nor hang a tab for an hour. */
const MIN_TURN_BUDGET_MS = 30_000;
const MAX_TURN_BUDGET_MS = 600_000;
const DEFAULT_CONCEPT_COUNT = 6;
const MIN_CONCEPT_COUNT = 3;
const MAX_CONCEPT_COUNT = 6;
/** Authored choice exits allow 2..6, so a turn may legitimately offer six. */
const MAX_TURN_OPTIONS = 6;
/**
 * The runtime declares the fade on every cue; this mirrors its value and is
 * used only when a cue omits one.
 */
const DEFAULT_MUSIC_PLAY_FADE_MS = 1_500;
/** A fade the player can neither hear nor wait out is not worth honouring. */
const MAX_MUSIC_FADE_MS = 10_000;
/**
 * Only reached when a track ships a gain we cannot read. Music sits under
 * narration, so the safe guess is quiet: a wrong-but-soft bed is recoverable,
 * a full-volume one talks over the story.
 */
const FALLBACK_MUSIC_GAIN = 0.6;
const OPTION_KINDS: readonly StoryOptionKind[] = ["choice", "suggestion"];

export class StoryNarrativeApiError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly code?: string;
  readonly fields?: unknown;
  readonly upstream: boolean;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      code?: string;
      fields?: unknown;
      upstream?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "StoryNarrativeApiError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.code = options.code;
    this.fields = options.fields;
    this.upstream = options.upstream ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function contractError(code: string, message: string): StoryNarrativeApiError {
  return new StoryNarrativeApiError(message, { code });
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback;
  const nested = isRecord(body.data) ? body.data : null;
  return (
    textValue(body.message) ||
    textValue(body.msg) ||
    textValue(body.error) ||
    textValue(body.detail) ||
    textValue(nested?.message) ||
    textValue(nested?.msg) ||
    textValue(nested?.error) ||
    textValue(nested?.detail) ||
    fallback
  );
}

function retryableFromBody(body: unknown): boolean {
  return (
    isRecord(body) &&
    (body.retryable === true || (isRecord(body.data) && body.data.retryable === true))
  );
}

function normalizedErrorCode(value: unknown): string | undefined {
  const code =
    typeof value === "number" && Number.isFinite(value) ? String(value) : textValue(value);
  return code && code !== "200" && code !== "SUCCESS" ? code : undefined;
}

function codeFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const nestedCode = isRecord(body.data) ? normalizedErrorCode(body.data.code) : undefined;
  if (nestedCode) return nestedCode;
  return normalizedErrorCode(body.code);
}

function statusFromBody(body: unknown): number | undefined {
  if (!isRecord(body)) return undefined;
  const candidates = [body.status, body.statusCode, body.code];
  for (const candidate of candidates) {
    const parsed =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" && /^\d{3}$/.test(candidate.trim())
          ? Number(candidate)
          : undefined;
    if (parsed !== undefined && Number.isInteger(parsed) && parsed >= 400 && parsed <= 599) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * The runtime names offending fields as `fields`; the shared Zod pipe answers a
 * body-shape 400 with `issues` instead. Both describe the same thing — which
 * part of the request the server would not take — so both are read here.
 */
function fieldsFromBody(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  if (body.fields !== undefined) return body.fields;
  if (body.issues !== undefined) return body.issues;
  if (!isRecord(body.data)) return undefined;
  return body.data.fields ?? body.data.issues;
}

/**
 * Success bodies arrive as `{ code: 200, data }`; failures arrive flat with a
 * non-2xx status and are handled before this ever runs. A 2xx that still
 * carries a failing envelope code is treated as an upstream failure.
 */
function unwrapEnvelope(body: unknown, status: number): unknown {
  if (!isRecord(body)) return body;
  if (!("code" in body) && !("data" in body)) return body;

  const ok = !("code" in body) || body.code === 200 || body.code === "200";
  if (!ok) {
    throw new StoryNarrativeApiError(messageFromBody(body, "Request failed"), {
      retryable: retryableFromBody(body),
      status: statusFromBody(body) ?? (status >= 400 ? status : undefined),
      code: codeFromBody(body),
      fields: fieldsFromBody(body),
      upstream: true,
    });
  }
  return body.data ?? body;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (isRecord(error) && error.name === "AbortError")
    ) {
      throw new StoryNarrativeApiError("Request timed out", { code: "REQUEST_TIMEOUT" });
    }
    if (error instanceof StoryNarrativeApiError) throw error;
    throw new StoryNarrativeApiError(
      error instanceof Error ? error.message : "Network request failed",
      { code: "NETWORK_ERROR" }
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  const parsed = raw ? parseJson(raw) : {};
  if (!res.ok) {
    throw new StoryNarrativeApiError(messageFromBody(parsed, raw.trim() || `HTTP ${res.status}`), {
      retryable: retryableFromBody(parsed),
      status: res.status,
      code: codeFromBody(parsed),
      fields: fieldsFromBody(parsed),
      upstream: true,
    });
  }
  return unwrapEnvelope(parsed, res.status);
}

function normalizeSetupOptions(value: unknown): StorySetupOptions {
  if (!isRecord(value)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no setupOptions");
  }
  if (!Array.isArray(value.paces)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned incomplete setupOptions");
  }

  const paces = value.paces.map((pace) => {
    if (!isRecord(pace)) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid pace option");
    }
    const key = textValue(pace.key);
    const label = textValue(pace.label);
    if (!key || !label) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an incomplete pace option");
    }
    return { key, label };
  });

  if (paces.length === 0) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned incomplete setupOptions");
  }
  if (new Set(paces.map((pace) => pace.key)).size !== paces.length) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned duplicate pace keys");
  }

  return { paces };
}

function silentMusic(): StoryMusicConfig {
  return { enabled: false, tracks: [] };
}

function musicGain(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FALLBACK_MUSIC_GAIN;
  return Math.min(1, Math.max(0, value));
}

function musicFadeMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(MAX_MUSIC_FADE_MS, value);
}

/**
 * Music is decoration, never the run: no shape of this block is worth failing
 * an enter over. A missing block, a block the server shipped disabled, and a
 * block whose tracks are all unusable all mean the same thing — play silent.
 */
function normalizeMusicConfig(value: unknown): StoryMusicConfig {
  if (!isRecord(value) || value.enabled !== true || !Array.isArray(value.tracks)) {
    return silentMusic();
  }

  const tracks: StoryMusicTrack[] = [];
  const seen = new Set<string>();
  for (const entry of value.tracks) {
    if (!isRecord(entry)) continue;
    const trackId = textValue(entry.trackId);
    const url = textValue(entry.url);
    // A duplicate id would make a cue ambiguous; the first one wins.
    if (!trackId || !url || seen.has(trackId)) continue;
    seen.add(trackId);
    tracks.push({ trackId, url, gain: musicGain(entry.gain) });
  }

  // Enabled with nothing playable is silence wearing a control.
  return tracks.length > 0 ? { enabled: true, tracks } : silentMusic();
}

/**
 * The cue is optional on every turn and absent on most of them. An unreadable
 * one is dropped rather than thrown: the worst outcome of ignoring a cue is
 * that the music does not change, and no cue is worth losing a turn over.
 */
function normalizeMusicCue(value: unknown): StoryMusicCue | undefined {
  if (!isRecord(value)) return undefined;
  if (textValue(value.action) !== "play") return undefined;

  const trackId = textValue(value.trackId);
  // A play cue that names no track describes nothing the player can act on.
  if (!trackId) return undefined;
  return {
    action: "play",
    trackId,
    fadeMs: musicFadeMs(value.fadeMs, DEFAULT_MUSIC_PLAY_FADE_MS),
  };
}

function normalizeEnterResult(value: unknown, expectedGameId: string): StoryEnterResult {
  if (!isRecord(value)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid enter response");
  }
  const sessionId = textValue(value.sessionId);
  if (!sessionId) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no sessionId");
  }

  const gameId = textValue(value.gameId);
  if (!gameId || gameId !== expectedGameId) {
    throw contractError(
      "ENTER_RESPONSE_INVALID",
      "Backend returned a session for a different story"
    );
  }

  const locale = textValue(value.locale);
  if (!locale) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no session locale");
  }

  const setupOptions = normalizeSetupOptions(value.setupOptions);
  const defaults = isRecord(value.defaults) ? value.defaults : {};
  const pace = textValue(defaults.pace) || undefined;
  if (pace && !setupOptions.paces.some((option) => option.key === pace)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an unknown default pace");
  }

  const turnBudgetMs = value.turnBudgetMs;
  if (
    typeof turnBudgetMs !== "number" ||
    !Number.isFinite(turnBudgetMs) ||
    turnBudgetMs < MIN_TURN_BUDGET_MS ||
    turnBudgetMs > MAX_TURN_BUDGET_MS
  ) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no usable turn budget");
  }

  return {
    sessionId,
    gameId,
    locale,
    prologue: textValue(value.prologue),
    setupOptions,
    defaults: { pace },
    turnBudgetMs,
    music: normalizeMusicConfig(value.music),
  };
}

/**
 * Only the ending's identity is load-bearing. Its title and summary are
 * authored localized prose, and a story may legitimately publish one of them
 * blank in the locale being played — the ending card already renders each part
 * conditionally, so a missing line is a shorter card, never a lost run.
 */
function normalizeEnding(value: unknown): StoryEnding | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid ending");
  }
  const endingId = textValue(value.endingId);
  if (!endingId) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned an ending with no id");
  }
  return { endingId, title: textValue(value.title), summary: textValue(value.summary) };
}

function normalizeTurnResult(value: unknown): StoryTurnResult {
  if (!isRecord(value)) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid turn response");
  }
  if (typeof value.finished !== "boolean") {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned no finished state");
  }
  const finished = value.finished;
  const narrative = textValue(value.narrative);
  // A turn that is still going and says nothing is broken. A turn that ENDED
  // the run is not: the graph can legitimately stop on a beat with nothing left
  // to read, and throwing there would destroy a run that just completed — the
  // most expensive possible way to react to a blank line.
  if (!narrative && !finished) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned no narrative");
  }

  if (!Array.isArray(value.options)) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned invalid turn options");
  }
  if (value.options.length > MAX_TURN_OPTIONS) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned too many turn options");
  }
  const options = value.options.map((option) => {
    if (!isRecord(option)) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid turn option");
    }
    const kind = textValue(option.kind);
    if (!OPTION_KINDS.includes(kind as StoryOptionKind)) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an unknown turn option kind");
    }
    const normalized = {
      id: textValue(option.id),
      label: textValue(option.label),
      kind: kind as StoryOptionKind,
    };
    if (!normalized.id || !normalized.label) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an incomplete turn option");
    }
    return normalized;
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned duplicate turn option ids");
  }
  // An authored decision and a free-form suggestion are answered by different
  // actions, so a mixed batch would make the click routing ambiguous.
  if (new Set(options.map((option) => option.kind)).size > 1) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend mixed turn option kinds");
  }

  const ending = normalizeEnding(value.ending);
  if (ending && !finished) {
    throw contractError(
      "TURN_RESPONSE_INVALID",
      "Backend returned an ending for an unfinished run"
    );
  }

  const music = normalizeMusicCue(value.music);

  return {
    narrative,
    options,
    finished,
    ...(ending ? { ending } : {}),
    ...(music ? { music } : {}),
  };
}

function normalizeConceptsResult(value: unknown, expectedGameId: string): StoryConceptsResult {
  if (!isRecord(value)) {
    throw contractError(
      "CONCEPTS_RESPONSE_INVALID",
      "Backend returned an invalid concepts response"
    );
  }

  const gameId = textValue(value.gameId);
  if (!gameId) {
    throw contractError("CONCEPTS_RESPONSE_INVALID", "Backend returned no story id for concepts");
  }
  if (gameId !== expectedGameId) {
    throw contractError(
      "CONCEPTS_RESPONSE_INVALID",
      "Backend returned concepts for a different story"
    );
  }
  if (!Array.isArray(value.items)) {
    throw contractError("CONCEPTS_RESPONSE_INVALID", "Backend returned no concept options");
  }

  const items = value.items.map((item) => {
    if (!isRecord(item)) {
      throw contractError(
        "CONCEPTS_RESPONSE_INVALID",
        "Backend returned an invalid concept option"
      );
    }
    const id = typeof item.id === "string" ? item.id : "";
    const contentMarkdown = typeof item.contentMarkdown === "string" ? item.contentMarkdown : "";
    if (!id.trim() || !contentMarkdown.trim()) {
      throw contractError(
        "CONCEPTS_RESPONSE_INVALID",
        "Backend returned an incomplete concept option"
      );
    }
    return { id, contentMarkdown };
  });

  if (items.length < MIN_CONCEPT_COUNT || items.length > MAX_CONCEPT_COUNT) {
    throw contractError(
      "CONCEPTS_RESPONSE_INVALID",
      `Backend returned ${items.length} concepts; expected 3 to 6`
    );
  }
  const uniqueIds = new Set(items.map((item) => item.id.trim()));
  if (uniqueIds.size !== items.length) {
    throw contractError("CONCEPTS_RESPONSE_INVALID", "Backend returned duplicate concept ids");
  }

  return { gameId, items };
}

const conceptsInFlight = new Map<string, Promise<StoryConceptsResult>>();

/**
 * Generate one fresh concept batch for a play-page run.
 *
 * The map is intentionally single-flight only: it prevents React Strict Mode
 * from duplicating the same expensive generation while a request is pending,
 * then forgets the result so a later restart still creates a fresh batch.
 */
export function getStoryConcepts(
  gameId: string,
  contentVersion: string,
  locale: Locale,
  count = DEFAULT_CONCEPT_COUNT
): Promise<StoryConceptsResult> {
  if (!Number.isInteger(count) || count < MIN_CONCEPT_COUNT || count > MAX_CONCEPT_COUNT) {
    return Promise.reject(
      contractError("CONCEPT_COUNT_INVALID", "Concept count must be an integer from 3 to 6")
    );
  }

  const key = JSON.stringify([gameId, contentVersion, locale, count]);
  const pending = conceptsInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const data = await postJson(
      CONCEPTS_ENDPOINT,
      { gameId, contentVersion, locale, count },
      CONCEPTS_TIMEOUT_MS
    );
    return normalizeConceptsResult(data, gameId);
  })();

  conceptsInFlight.set(key, request);
  const clear = () => {
    if (conceptsInFlight.get(key) === request) conceptsInFlight.delete(key);
  };
  request.then(clear, clear);
  return request;
}

export async function enterStoryPlay(
  gameId: string,
  contentVersion: string,
  locale: Locale,
  selectedConcept: StoryConceptOption
): Promise<StoryEnterResult> {
  if (!selectedConcept.id.trim() || !selectedConcept.contentMarkdown.trim()) {
    throw new StoryNarrativeApiError("A complete story concept is required", {
      code: "INVALID_CONCEPT",
    });
  }

  const data = await postJson(
    ENTER_ENDPOINT,
    {
      gameId,
      contentVersion,
      locale,
      selectedConceptId: selectedConcept.id,
      selectedConceptMarkdown: selectedConcept.contentMarkdown,
    },
    ENTER_TIMEOUT_MS
  );
  return normalizeEnterResult(data, gameId);
}

export async function playStoryTurn(
  req: {
    sessionId: string;
    action: StoryTurnAction;
    setup?: { pace: string };
    choiceId?: string;
    text?: string;
  },
  /** The run's server-declared worst-case turn budget, from `enter`. */
  turnBudgetMs: number
): Promise<StoryTurnResult> {
  const data = await postJson(TURNS_ENDPOINT, req, turnBudgetMs + TURN_TIMEOUT_SLACK_MS);
  return normalizeTurnResult(data);
}
