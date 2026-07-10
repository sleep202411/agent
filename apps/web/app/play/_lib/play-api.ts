/**
 * Client fetchers for the IP-direct Java narrative runtime.
 */

import type { Locale } from "@/src/i18n/config";
import { getIpCommerceIp, type IpCommerceIp } from "@/src/lib/ip-commerce/api";

export interface PlaySetupOptions {
  roles: Array<{
    id: string;
    name: string;
    role: string;
    tagline: string;
    profileMarkdown: string;
  }>;
  directions: Array<{ key: string; label: string }>;
  paces: Array<{ key: string; label: string }>;
}

export interface PlayConceptOption {
  id: string;
  contentMarkdown: string;
}

export interface ConceptsResult {
  ipId: string;
  items: PlayConceptOption[];
}

export interface EnterResult {
  sessionId: string;
  ipId: string;
  prologue: string;
  setupOptions: PlaySetupOptions;
  defaults: { roleId?: string; directionKey?: string; pace?: string };
}

export interface TurnResult {
  turnCount?: number;
  narrative: string;
  options: Array<{ id: string; label: string }>;
  finished: boolean;
  playerPersonality?: PlayerPersonality;
}

export type PlayTurnAction = "start" | "continue" | "choice" | "free";

export interface PlayerPersonality {
  title: string;
  summary: string;
}

const CONCEPTS_ENDPOINT = "/api/player/narrative/concepts";
const ENTER_ENDPOINT = "/api/player/narrative/enter";
const TURNS_ENDPOINT = "/api/player/narrative/turns";
const DEFAULT_CONCEPT_COUNT = 6;
const MIN_CONCEPT_COUNT = 3;
const MAX_CONCEPT_COUNT = 6;

export class NarrativeApiError extends Error {
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
    this.name = "NarrativeApiError";
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

function contractError(code: string, message: string): NarrativeApiError {
  return new NarrativeApiError(message, { code });
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback;
  const nested = isRecord(body.data) ? body.data : null;
  return (
    textValue(body.msg) ||
    textValue(body.message) ||
    textValue(body.error) ||
    textValue(body.detail) ||
    textValue(nested?.msg) ||
    textValue(nested?.message) ||
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
  const candidates = [body.code, isRecord(body.data) ? body.data.code : undefined];
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

function fieldsFromBody(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  if (body.fields !== undefined) return body.fields;
  return isRecord(body.data) ? body.data.fields : undefined;
}

function javaPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_API_STUDIO_PREFIX ?? ""}${path}`;
}

function unwrapJavaBody(body: unknown, status?: number): unknown {
  if (!isRecord(body)) return body;
  const hasEnvelope =
    "code" in body || "success" in body || ("data" in body && ("msg" in body || "message" in body));
  if (!hasEnvelope) return body;

  const ok =
    "code" in body
      ? body.code === 200 || body.code === "200" || body.code === "SUCCESS"
      : body.success === true;
  if (!ok) {
    throw new NarrativeApiError(messageFromBody(body, "Request failed"), {
      retryable: retryableFromBody(body),
      status: statusFromBody(body) ?? (status !== undefined && status >= 400 ? status : undefined),
      code: codeFromBody(body),
      fields: fieldsFromBody(body),
      upstream: true,
    });
  }
  return body.data ?? body;
}

async function postJavaJson(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(javaPath(path), {
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
      throw new NarrativeApiError("Request timed out", { code: "REQUEST_TIMEOUT" });
    }
    if (error instanceof NarrativeApiError) throw error;
    throw new NarrativeApiError(error instanceof Error ? error.message : "Network request failed", {
      code: "NETWORK_ERROR",
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  const parsed = raw ? parseJson(raw) : {};
  if (!res.ok) {
    throw new NarrativeApiError(messageFromBody(parsed, raw.trim() || `HTTP ${res.status}`), {
      retryable: retryableFromBody(parsed),
      status: statusFromBody(parsed) ?? res.status,
      code: codeFromBody(parsed),
      fields: fieldsFromBody(parsed),
      upstream: true,
    });
  }
  return unwrapJavaBody(parsed, res.status);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function normalizeSetupOptions(value: unknown): PlaySetupOptions {
  if (!isRecord(value)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no setupOptions");
  }
  if (
    !Array.isArray(value.roles) ||
    !Array.isArray(value.directions) ||
    !Array.isArray(value.paces)
  ) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned incomplete setupOptions");
  }

  const roles = value.roles.map((role) => {
    if (!isRecord(role)) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid role option");
    }
    const normalized = {
      id: textValue(role.id),
      name: textValue(role.name),
      role: textValue(role.role),
      tagline: textValue(role.tagline),
      profileMarkdown: typeof role.profileMarkdown === "string" ? role.profileMarkdown : "",
    };
    if (!normalized.id || !normalized.name || !normalized.profileMarkdown.trim()) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an incomplete role option");
    }
    return normalized;
  });
  const directions = value.directions.map((direction) => {
    if (!isRecord(direction)) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid direction option");
    }
    const normalized = { key: textValue(direction.key), label: textValue(direction.label) };
    if (!normalized.key || !normalized.label) {
      throw contractError(
        "ENTER_RESPONSE_INVALID",
        "Backend returned an incomplete direction option"
      );
    }
    return normalized;
  });
  const paces = value.paces.map((pace) => {
    if (!isRecord(pace)) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid pace option");
    }
    const normalized = { key: textValue(pace.key), label: textValue(pace.label) };
    if (!normalized.key || !normalized.label) {
      throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an incomplete pace option");
    }
    return normalized;
  });

  if (roles.length === 0 || directions.length === 0 || paces.length === 0) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned incomplete setupOptions");
  }
  if (new Set(roles.map((role) => role.id)).size !== roles.length) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned duplicate role ids");
  }
  if (new Set(directions.map((direction) => direction.key)).size !== directions.length) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned duplicate direction keys");
  }
  if (new Set(paces.map((pace) => pace.key)).size !== paces.length) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned duplicate pace keys");
  }

  return { roles, directions, paces };
}

function normalizeEnterResult(value: unknown, expectedIpId: string): EnterResult {
  if (!isRecord(value)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an invalid enter response");
  }
  const sessionId = textValue(value.sessionId);
  if (!sessionId) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned no sessionId");
  }

  const ipId = textValue(value.ipId);
  if (!ipId || ipId !== expectedIpId) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned a session for a different IP");
  }

  const setupOptions = normalizeSetupOptions(value.setupOptions);
  const defaults = isRecord(value.defaults) ? value.defaults : {};
  const roleId = textValue(defaults.roleId) || undefined;
  const directionKey = textValue(defaults.directionKey) || undefined;
  const pace = textValue(defaults.pace) || undefined;
  if (roleId && !setupOptions.roles.some((role) => role.id === roleId)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an unknown default role");
  }
  if (
    directionKey &&
    !setupOptions.directions.some((direction) => direction.key === directionKey)
  ) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an unknown default direction");
  }
  if (pace && !setupOptions.paces.some((option) => option.key === pace)) {
    throw contractError("ENTER_RESPONSE_INVALID", "Backend returned an unknown default pace");
  }

  return {
    sessionId,
    ipId,
    prologue: textValue(value.prologue),
    setupOptions,
    defaults: { roleId, directionKey, pace },
  };
}

function normalizeTurnResult(value: unknown): TurnResult {
  if (!isRecord(value)) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid turn response");
  }
  const narrative = textValue(value.narrative);
  if (!narrative) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned no narrative");
  }
  let turnCount: number | undefined;
  if (value.turnCount !== undefined) {
    if (
      typeof value.turnCount !== "number" ||
      !Number.isInteger(value.turnCount) ||
      value.turnCount < 0
    ) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid turn count");
    }
    turnCount = value.turnCount;
  }
  if (typeof value.finished !== "boolean") {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned no finished state");
  }
  const playerPersonality = normalizePlayerPersonality(value.playerPersonality);

  if (!Array.isArray(value.options)) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned invalid turn options");
  }
  if (value.options.length > 3) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned too many turn options");
  }
  const options = value.options.map((option) => {
    if (!isRecord(option)) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an invalid turn option");
    }
    const normalized = { id: textValue(option.id), label: textValue(option.label) };
    if (!normalized.id || !normalized.label) {
      throw contractError("TURN_RESPONSE_INVALID", "Backend returned an incomplete turn option");
    }
    return normalized;
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw contractError("TURN_RESPONSE_INVALID", "Backend returned duplicate turn option ids");
  }

  return {
    narrative,
    options,
    finished: value.finished === true,
    ...(turnCount !== undefined ? { turnCount } : {}),
    ...(playerPersonality ? { playerPersonality } : {}),
  };
}

function normalizePlayerPersonality(value: unknown): PlayerPersonality | undefined {
  if (!isRecord(value)) return undefined;
  const title = textValue(value.title);
  const summary = textValue(value.summary);
  if (!title && !summary) return undefined;
  return { title, summary };
}

async function loadIpStory(ipId: string, locale: Locale): Promise<string | undefined> {
  const res = await getIpCommerceIp(ipId, { locale });
  return buildIpStory(res.ip);
}

function buildIpStory(ip: IpCommerceIp): string | undefined {
  const parts = [
    ip.title,
    ip.subtitle,
    ip.summary,
    ip.description,
    ...ip.episodes.map((episode) =>
      [episode.title, episode.subtitle, episode.summary].filter(Boolean).join(": ")
    ),
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  if (parts.length === 0) return undefined;
  return Array.from(new Set(parts)).join("\n\n");
}

function normalizeConceptsResult(value: unknown, expectedIpId: string): ConceptsResult {
  if (!isRecord(value)) {
    throw contractError(
      "CONCEPTS_RESPONSE_INVALID",
      "Backend returned an invalid concepts response"
    );
  }

  const ipId = textValue(value.ipId);
  if (!ipId) {
    throw contractError("CONCEPTS_RESPONSE_INVALID", "Backend returned no IP id for concepts");
  }
  if (ipId !== expectedIpId) {
    throw contractError(
      "CONCEPTS_RESPONSE_INVALID",
      "Backend returned concepts for a different IP"
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

  return { ipId, items };
}

const conceptsInFlight = new Map<string, Promise<ConceptsResult>>();

/**
 * Generate one fresh concept batch for a play-page run.
 *
 * The map is intentionally single-flight only: it prevents React Strict Mode
 * from duplicating the same expensive generation while a request is pending,
 * then forgets the result so a later restart still creates a fresh batch.
 */
export function getPlayConcepts(
  ipId: string,
  locale: Locale,
  count = DEFAULT_CONCEPT_COUNT
): Promise<ConceptsResult> {
  if (!Number.isInteger(count) || count < MIN_CONCEPT_COUNT || count > MAX_CONCEPT_COUNT) {
    return Promise.reject(
      contractError("CONCEPT_COUNT_INVALID", "Concept count must be an integer from 3 to 6")
    );
  }

  const key = JSON.stringify([ipId, locale, count]);
  const pending = conceptsInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const ipStory = await loadIpStory(ipId, locale);
    if (!ipStory) {
      throw new NarrativeApiError("This IP has no story content to generate from", {
        code: "EMPTY_IP_STORY",
      });
    }

    const data = await postJavaJson(CONCEPTS_ENDPOINT, { ipId, locale, ipStory, count }, 180_000);
    return normalizeConceptsResult(data, ipId);
  })();

  conceptsInFlight.set(key, request);
  const clear = () => {
    if (conceptsInFlight.get(key) === request) conceptsInFlight.delete(key);
  };
  request.then(clear, clear);
  return request;
}

export async function enterPlay(
  ipId: string,
  locale: Locale,
  selectedConcept: PlayConceptOption
): Promise<EnterResult> {
  if (!selectedConcept.id.trim() || !selectedConcept.contentMarkdown.trim()) {
    throw new NarrativeApiError("A complete story concept is required", {
      code: "INVALID_CONCEPT",
    });
  }

  const data = await postJavaJson(
    ENTER_ENDPOINT,
    {
      ipId,
      locale,
      selectedConceptId: selectedConcept.id,
      selectedConceptMarkdown: selectedConcept.contentMarkdown,
    },
    180_000
  );
  return normalizeEnterResult(data, ipId);
}

export async function playTurn(
  _locale: Locale,
  req: {
    sessionId: string;
    action: PlayTurnAction;
    setup?: { roleId?: string; directionKey?: string; pace?: string };
    choiceId?: string;
    text?: string;
  }
): Promise<TurnResult> {
  const data = await postJavaJson(TURNS_ENDPOINT, req, 90_000);
  return normalizeTurnResult(data);
}
