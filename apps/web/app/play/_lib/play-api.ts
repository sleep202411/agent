/**
 * Client fetchers for the IP-direct Java narrative runtime.
 */

import type { Locale } from "@/src/i18n/config";
import { getIpCommerceIp, type IpCommerceIp } from "@/src/lib/ip-commerce/api";

export interface PlaySetupOptions {
  roles: Array<{ id: string; name: string; role: string; tagline: string }>;
  directions: Array<{ key: string; label: string }>;
  paces: Array<{ key: string; label: string }>;
}

export interface EnterResult {
  sessionId: string;
  ipId: string;
  title?: string;
  prologue: string;
  setupOptions: PlaySetupOptions;
  defaults: { roleId?: string; directionKey?: string; pace?: string };
}

export interface TurnResult {
  turnCount: number;
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

const ENTER_ENDPOINT = "/api/player/narrative/enter";
const TURNS_ENDPOINT = "/api/player/narrative/turns";

class NarrativeApiError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "NarrativeApiError";
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback;
  return (
    textValue(body.msg) ||
    textValue(body.message) ||
    textValue(body.error) ||
    textValue(body.detail) ||
    fallback
  );
}

function retryableFromBody(body: unknown): boolean {
  return isRecord(body) && body.retryable === true;
}

function javaPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_API_STUDIO_PREFIX ?? ""}${path}`;
}

function unwrapJavaBody(body: unknown): unknown {
  if (!isRecord(body)) return body;
  const hasEnvelope =
    "code" in body || "success" in body || ("data" in body && ("msg" in body || "message" in body));
  if (!hasEnvelope) return body;

  const ok =
    body.success === true || body.code === 200 || body.code === "200" || body.code === "SUCCESS";
  if (!ok) {
    throw new NarrativeApiError(messageFromBody(body, "Request failed"), retryableFromBody(body));
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
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  const parsed = raw ? parseJson(raw) : {};
  if (!res.ok) {
    throw new NarrativeApiError(
      messageFromBody(parsed, raw.trim() || `HTTP ${res.status}`),
      retryableFromBody(parsed)
    );
  }
  return unwrapJavaBody(parsed);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function normalizeSetupOptions(value: unknown): PlaySetupOptions {
  if (!isRecord(value)) throw new Error("Backend returned no setupOptions");

  const roles = Array.isArray(value.roles)
    ? value.roles
        .filter(isRecord)
        .map((role) => ({
          id: textValue(role.id),
          name: textValue(role.name),
          role: textValue(role.role),
          tagline: textValue(role.tagline),
        }))
        .filter((role) => role.id && role.name)
    : [];
  const directions = Array.isArray(value.directions)
    ? value.directions
        .filter(isRecord)
        .map((direction) => ({
          key: textValue(direction.key),
          label: textValue(direction.label),
        }))
        .filter((direction) => direction.key && direction.label)
    : [];
  const paces = Array.isArray(value.paces)
    ? value.paces
        .filter(isRecord)
        .map((pace) => ({
          key: textValue(pace.key),
          label: textValue(pace.label),
        }))
        .filter((pace) => pace.key && pace.label)
    : [];

  if (directions.length === 0 || paces.length === 0) {
    throw new Error("Backend returned incomplete setupOptions");
  }

  return { roles, directions, paces };
}

function normalizeEnterResult(value: unknown): EnterResult {
  if (!isRecord(value)) throw new Error("Backend returned an invalid enter response");
  const sessionId = textValue(value.sessionId);
  if (!sessionId) throw new Error("Backend returned no sessionId");

  const defaults = isRecord(value.defaults) ? value.defaults : {};
  return {
    sessionId,
    ipId: textValue(value.ipId),
    title: textValue(value.title) || undefined,
    prologue: textValue(value.prologue),
    setupOptions: normalizeSetupOptions(value.setupOptions),
    defaults: {
      roleId: textValue(defaults.roleId) || undefined,
      directionKey: textValue(defaults.directionKey) || undefined,
      pace: textValue(defaults.pace) || undefined,
    },
  };
}

function normalizeTurnResult(value: unknown): TurnResult {
  if (!isRecord(value)) throw new Error("Backend returned an invalid turn response");
  const narrative = textValue(value.narrative);
  if (!narrative) throw new Error("Backend returned no narrative");
  const turnCount = typeof value.turnCount === "number" ? value.turnCount : 0;
  const playerPersonality = normalizePlayerPersonality(value.playerPersonality);

  const options = Array.isArray(value.options)
    ? value.options
        .filter(isRecord)
        .map((option, index) => ({
          id: textValue(option.id) || `a${index + 1}`,
          label: textValue(option.label),
        }))
        .filter((option) => option.label)
        .slice(0, 3)
    : [];

  return {
    turnCount,
    narrative,
    options,
    finished: value.finished === true,
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
  return Array.from(new Set(parts)).join("\n\n").slice(0, 12_000);
}

export async function enterPlay(ipId: string, locale: Locale): Promise<EnterResult> {
  const ipStory = await loadIpStory(ipId, locale);
  const body = {
    ipId,
    locale,
    ...(ipStory ? { ipStory } : {}),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await postJavaJson(ENTER_ENDPOINT, body, 180_000);
      return normalizeEnterResult(data);
    } catch (error) {
      lastError = error;
      if (!(error instanceof NarrativeApiError && error.retryable)) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
