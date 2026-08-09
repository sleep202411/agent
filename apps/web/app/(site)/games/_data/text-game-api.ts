import "server-only";

import {
  TextGameDetailSchema,
  TextGameSummaryListSchema,
  type TextGameDetail,
  type TextGameSummary,
} from "@repo/shared/text-game";

const TEXT_GAME_API_PATH = "/api/player/text-game";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface JavaEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

export class TextGameLoadError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "TextGameLoadError";
  }
}

export async function listPublishedTextGames(
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<TextGameSummary[]> {
  const data = await getJavaData(
    `${javaBaseUrl(options.javaStudioUrl)}${TEXT_GAME_API_PATH}`,
    options.fetcher ?? fetch
  );
  const parsed = TextGameSummaryListSchema.safeParse(data);
  if (!parsed.success) {
    throw new TextGameLoadError("Java returned an invalid text-adventure catalogue.");
  }
  return parsed.data;
}

export async function getPublishedTextGame(
  gameId: string,
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<TextGameDetail> {
  const data = await getJavaData(
    `${javaBaseUrl(options.javaStudioUrl)}${TEXT_GAME_API_PATH}/${encodeURIComponent(gameId)}`,
    options.fetcher ?? fetch
  );
  const parsed = TextGameDetailSchema.safeParse(data);
  if (!parsed.success) {
    throw new TextGameLoadError("Java returned invalid text-adventure metadata.");
  }
  if (parsed.data.gameId !== gameId) {
    throw new TextGameLoadError(
      `Java returned text adventure ${parsed.data.gameId} while ${gameId} was requested.`
    );
  }
  return parsed.data;
}

function javaBaseUrl(override?: string): string {
  const value = override ?? process.env.JAVA_STUDIO_URL;
  if (!value?.trim()) throw new Error("Missing required environment variable: JAVA_STUDIO_URL");
  return value.replace(/\/+$/, "");
}

async function getJavaData(url: string, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new TextGameLoadError(
      error instanceof Error ? error.message : "The text-adventure service could not be reached."
    );
  }

  let body: JavaEnvelope;
  try {
    body = (await response.json()) as JavaEnvelope;
  } catch {
    throw new TextGameLoadError(
      "The text-adventure service returned an invalid response.",
      response.status
    );
  }

  if (!response.ok || body.code !== 200) {
    throw new TextGameLoadError(
      typeof body.msg === "string" && body.msg.trim()
        ? body.msg
        : `The text-adventure request failed (HTTP ${response.status}).`,
      response.status
    );
  }
  return body.data;
}
