import type {
  PlaySessionReporter,
  StartPayload,
  ProgressPayload,
  CompletePayload,
} from "@repo/experience-engine";
import { api } from "@/src/lib/api/api-client";

export interface HttpPlaySessionReporterOptions {
  getAccessToken?: () => Promise<string | null>;
}

export function createHttpPlaySessionReporter(
  options: HttpPlaySessionReporterOptions = {}
): PlaySessionReporter {
  const getHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    if (options.getAccessToken) {
      try {
        const token = await options.getAccessToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      } catch {
        // Ignore token fetch errors
      }
    }
    return headers;
  };

  return {
    async onStart(payload: StartPayload): Promise<{ sessionId: string } | null> {
      try {
        const headers = await getHeaders();
        const res = await api.post<{ sessionId: string }>("/api/player/play/sessions/start", {
          data: payload,
          headers,
        });
        if (res && typeof res.sessionId === "string") {
          return { sessionId: res.sessionId };
        }
        return null;
      } catch (err) {
        console.warn("[HttpPlaySessionReporter] onStart failed:", err);
        return null;
      }
    },

    async onProgress(sessionId: string, payload: ProgressPayload): Promise<void> {
      if (!sessionId) return;
      try {
        const headers = await getHeaders();
        await api.post("/api/player/play/sessions/progress", {
          data: {
            sessionId,
            ...payload,
          },
          headers,
        });
      } catch (err) {
        console.warn("[HttpPlaySessionReporter] onProgress failed:", err);
        throw err;
      }
    },

    async onComplete(sessionId: string, payload: CompletePayload): Promise<void> {
      if (!sessionId) return;
      try {
        const headers = await getHeaders();
        await api.post("/api/player/play/sessions/complete", {
          data: {
            sessionId,
            ...payload,
          },
          headers,
        });
      } catch (err) {
        console.warn("[HttpPlaySessionReporter] onComplete failed:", err);
        throw err;
      }
    },
  };
}

export interface PlaySessionReport {
  sessionId: string;
  gameId: string;
  gameTitle: string;
  experienceType: "text" | "film";
  contentVersion: string;
  status: "playing" | "completed" | "abandoned";
  endingId: string | null;
  endingReachCount: string | number;
  activePlayMs: string | number;
  turnCount: number;
  freeActionCount: number;
  currentChapter: string;
  currentNode: string;
  path: Array<{
    chapter: string;
    node: string;
    firstTurnIndex?: number;
    lastTurnIndex?: number;
  }>;
  choices: Array<{
    optionId: string;
    label: string;
    decisionId: string;
    chapter: string;
    node: string;
  }>;
  startedAt: string;
  completedAt: string | null;
}

export async function fetchPlaySessionReport(sessionId: string): Promise<PlaySessionReport> {
  const url = `/api/player/play/sessions/${encodeURIComponent(sessionId)}/report`;
  return api.get<PlaySessionReport>(url);
}
