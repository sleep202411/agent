import { NextRequest, NextResponse } from "next/server";

import { callLlmJson, getLlmKey, LlmError } from "../_lib/llm";
import { writerMessages } from "../_lib/prompts";
import { openSession, sealSession } from "../_lib/session-token";
import type { ActStage, TurnRequest, TurnResponse } from "../_lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACT_ORDER: ActStage[] = ["qi", "cheng", "zhuan", "he"];

type WriterOut = {
  narrative?: string;
  options?: Array<{ id?: string; label?: string }>;
  endingId?: string | null;
  unlockClueIds?: string[];
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** POST /narrative-runtime/play-turn — session-driven turn (start/continue/choice/free). */
export async function POST(request: NextRequest) {
  if (!getLlmKey()) return json({ error: "LLM key not set" }, 503);

  let body: TurnRequest;
  try {
    body = (await request.json()) as TurnRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const sessionId = body.sessionId?.trim();
  if (!sessionId) return json({ error: "sessionId is required" }, 400);

  const session = openSession(sessionId);
  if (!session) return json({ error: "Invalid or corrupt session token", code: "BAD_TOKEN" }, 400);

  const { bible, live } = session;
  const action = body.action;

  if (action === "start") {
    live.setup = {
      roleId: body.setup?.roleId ?? bible.characters.find((c) => c.playable && c.public)?.id,
      directionKey: body.setup?.directionKey ?? "suspense",
      pace: body.setup?.pace ?? "standard",
    };
  }
  if (!live.setup) live.setup = { directionKey: "suspense", pace: "standard" };

  const choiceLabel =
    action === "choice"
      ? (live.lastOptions.find((o) => o.id === body.choiceId)?.label ?? body.choiceId)
      : undefined;
  const playerText = action === "free" ? body.text?.trim() : undefined;
  if (action === "free" && !playerText)
    return json({ error: "text is required for a free action" }, 422);

  let out: WriterOut;
  try {
    out = await callLlmJson<WriterOut>(
      writerMessages({ bible, live, setup: live.setup, action, playerText, choiceLabel }),
      { temperature: 0.78, maxTokens: 850, timeoutMs: 45_000 }
    );
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 502;
    return json({ error: "Turn generation failed", detail: errMsg(e) }, status);
  }

  const narrative = (out.narrative ?? "").trim() || "……";
  const options = (Array.isArray(out.options) ? out.options : [])
    .filter((o): o is { id?: string; label?: string } => !!o && typeof o.label === "string")
    .slice(0, 4)
    .map((o, i) => ({ id: String(o.id ?? `a${i}`), label: String(o.label) }));
  const endingId =
    out.endingId && bible.endings.some((e) => e.id === out.endingId) ? out.endingId : null;
  const finished = endingId != null;

  // ── update live state ──
  if (action === "free" && playerText) live.recentTurns.push({ role: "player", text: playerText });
  else if (action === "choice" && choiceLabel)
    live.recentTurns.push({ role: "player", text: `[选择] ${choiceLabel}` });
  live.recentTurns.push({ role: "narrator", text: narrative });
  live.recentTurns = live.recentTurns.slice(-16);
  live.lastOptions = options;
  live.turnCount += 1;

  for (const cid of out.unlockClueIds ?? []) {
    if (bible.clues.some((c) => c.id === cid) && !live.unlockedClueIds.includes(cid)) {
      live.unlockedClueIds.push(cid);
    }
  }

  // Rough act pacing by turn count; never regress; snap to 合 on finish.
  const paced = ACT_ORDER[Math.min(ACT_ORDER.length - 1, Math.floor(live.turnCount / 4))];
  if (ACT_ORDER.indexOf(paced) > ACT_ORDER.indexOf(live.stage)) live.stage = paced;
  if (finished) live.stage = "he";

  const res: TurnResponse = {
    narrative,
    options,
    finished,
    stage: live.stage,
    turnCount: live.turnCount,
    sessionId: sealSession(session), // refreshed stateless token for the next turn
  };
  return json(res);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
