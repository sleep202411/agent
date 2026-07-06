import { NextRequest, NextResponse } from "next/server";

import { callLlmJson, getLlmKey, LlmError } from "../_lib/llm";
import { fetchIpSeed } from "../_lib/ip-seed";
import { architectMessages } from "../_lib/prompts";
import { sealSession } from "../_lib/session-token";
import type { Bible, EnterResponse, LiveState, SetupOptions } from "../_lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed adaptation / pace lists (contract §附.1/§附.2).
const DIRECTIONS = [
  { key: "suspense", label: "悬疑" },
  { key: "romance", label: "浪漫" },
  { key: "adventure", label: "冒险" },
  { key: "growth", label: "成长" },
  { key: "cyberpunk", label: "赛博朋克" },
  { key: "era_ensemble", label: "时代群像" },
];
const PACES = [
  { key: "slow", label: "慢热" },
  { key: "standard", label: "标准" },
  { key: "compact", label: "紧凑" },
];

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** POST /narrative-runtime/enter — generate a per-session bible, return setup options. */
export async function POST(request: NextRequest) {
  if (!getLlmKey()) return json({ error: "LLM key not set on the web server." }, 503);

  let body: { ipId?: string; locale?: string };
  try {
    body = (await request.json()) as { ipId?: string; locale?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const ipId = body.ipId?.trim();
  const locale = body.locale?.trim() || "zh-CN";
  if (!ipId) return json({ error: "ipId is required" }, 400);

  const seed = await fetchIpSeed(ipId, locale);
  if (!seed) return json({ error: "IP not found" }, 404);

  // Generation is occasionally flaky (a slow gen, or the model returning
  // malformed/truncated JSON), so retry once before surfacing the failure.
  let bible: Bible | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !bible; attempt++) {
    try {
      bible = await callLlmJson<Bible>(architectMessages(seed), {
        temperature: 0.8,
        maxTokens: 6000, // headroom so a verbose bible isn't truncated
        timeoutMs: 120_000,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  if (!bible) {
    const status = lastErr instanceof LlmError ? lastErr.status : 502;
    return json({ error: "Failed to generate the story", detail: errMsg(lastErr) }, status);
  }

  // Lenient coercion so a slightly-off model shape doesn't 500 the loop.
  bible.acts = Array.isArray(bible.acts) ? bible.acts : [];
  bible.characters = Array.isArray(bible.characters) ? bible.characters : [];
  bible.clues = Array.isArray(bible.clues) ? bible.clues : [];
  bible.endings = Array.isArray(bible.endings) ? bible.endings : [];
  if (bible.characters.length === 0) {
    return json({ error: "Generated story had no characters; try again." }, 502);
  }

  const live: LiveState = {
    setup: null,
    turnCount: 0,
    stage: "qi",
    unlockedClueIds: [],
    recentTurns: [],
    lastOptions: [],
  };
  const sessionId = sealSession({ ipId, ipTitle: seed.title, locale, bible, live });

  const playable = bible.characters.filter((c) => c.playable && c.public);
  const roles = (playable.length ? playable : bible.characters.slice(0, 1)).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    tagline: c.tagline ?? "",
  }));

  const setupOptions: SetupOptions = { roles, directions: DIRECTIONS, paces: PACES };
  const res: EnterResponse = {
    sessionId,
    ipId,
    title: seed.title,
    prologue: seed.summary ?? "",
    setupOptions,
    defaults: { roleId: roles[0]?.id, directionKey: "suspense", pace: "standard" },
  };
  return json(res);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
