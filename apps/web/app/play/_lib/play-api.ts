/**
 * Client fetchers for the IP-direct play prototype (Next enter/play-turn routes).
 * Locale-prefixed paths so the proxy routes them without a redirect.
 */

import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";

export interface PlaySetupOptions {
  roles: Array<{ id: string; name: string; role: string; tagline: string }>;
  directions: Array<{ key: string; label: string }>;
  paces: Array<{ key: string; label: string }>;
}

export interface EnterResult {
  sessionId: string;
  ipId: string;
  title: string;
  prologue: string;
  setupOptions: PlaySetupOptions;
  defaults: { roleId?: string; directionKey?: string; pace?: string };
}

export interface TurnResult {
  narrative: string;
  options: Array<{ id: string; label: string }>;
  finished: boolean;
  stage: string;
  turnCount: number;
  /** Refreshed stateless session token to send on the next turn. */
  sessionId: string;
}

export type PlayTurnAction = "start" | "continue" | "choice" | "free";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  if (!res.ok)
    throw new Error(
      [data?.error, data?.detail].filter(Boolean).join(" · ") || `HTTP ${res.status}`
    );
  return data as T;
}

export function enterPlay(ipId: string, locale: Locale): Promise<EnterResult> {
  return postJson(localizePath("/narrative-runtime/enter", locale), { ipId, locale });
}

export function playTurn(
  locale: Locale,
  req: {
    sessionId: string;
    action: PlayTurnAction;
    setup?: { roleId?: string; directionKey?: string; pace?: string };
    choiceId?: string;
    text?: string;
  }
): Promise<TurnResult> {
  return postJson(localizePath("/narrative-runtime/play-turn", locale), req);
}
