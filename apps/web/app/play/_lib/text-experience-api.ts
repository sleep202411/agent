/**
 * Client fetchers for the published text-adventure runtime.
 *
 * A text adventure is an authored skeleton the model narrates between anchors,
 * so it plays as a turn loop against our own backend instead of the frozen
 * manifest an interactive film replays. The runtime is stateless: the client
 * carries the play state and returns it every turn.
 */

export type TextPlayEvent =
  | { kind: "anchor"; nodeId?: string; title?: string; body?: string }
  | { kind: "narration"; text?: string }
  | {
      kind: "choices";
      prompt?: string;
      choices?: Array<{ choiceId: string; label: string }>;
    }
  | { kind: "suggestions"; items?: string[] }
  | { kind: "ending"; title?: string; summary?: string }
  | { kind: "end" };

/** An angle into the authored story, picked before the first beat. */
export interface TextPlayDirection {
  id: string;
  title: string;
  logline: string;
  tags: string[];
  conflict: string;
  hook: string;
  twist: string;
  tagline: string;
}

export interface TextPlayState {
  nodeId: string | null;
  direction: TextPlayDirection | null;
  freeTurnsUsed: number;
  transcript: Array<{ role: "narration" | "player" | "anchor"; text: string }>;
}

export interface TextPlayResult {
  events: TextPlayEvent[];
  state: TextPlayState;
  ended: boolean;
}

export type TextPlayAction =
  | { kind: "continue" }
  | { kind: "choice"; choiceId: string }
  | { kind: "free"; text: string };

export class TextPlayError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TextPlayError";
  }
}

const BASE = "/aurora/story-experiences";

async function post(path: string, body: unknown): Promise<TextPlayResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new TextPlayError(
      "TEXT_PLAY_UNREACHABLE",
      error instanceof Error ? error.message : "The story runtime is unreachable."
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new TextPlayError(
      typeof record.code === "string" ? record.code : "TEXT_PLAY_FAILED",
      typeof record.message === "string" ? record.message : "This turn could not be played."
    );
  }
  return record.data as TextPlayResult;
}

export async function getTextPlayDirections(
  gameId: string,
  contentVersion: string,
  count = 6
): Promise<TextPlayDirection[]> {
  const data = (await post(`/${encodeURIComponent(gameId)}/text-play/directions`, {
    contentVersion,
    count,
  })) as unknown as { directions?: TextPlayDirection[] };
  return data.directions ?? [];
}

export function startTextPlay(
  gameId: string,
  contentVersion: string,
  direction: TextPlayDirection | null = null
): Promise<TextPlayResult> {
  return post(`/${encodeURIComponent(gameId)}/text-play/start`, { contentVersion, direction });
}

export function playTextTurn(
  gameId: string,
  contentVersion: string,
  input: { state: TextPlayState; action: TextPlayAction; freeTurnLimit: number }
): Promise<TextPlayResult> {
  return post(`/${encodeURIComponent(gameId)}/text-play/turn`, {
    contentVersion,
    ...input,
  });
}
