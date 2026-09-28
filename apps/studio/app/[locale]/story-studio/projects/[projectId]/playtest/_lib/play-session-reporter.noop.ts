import type {
  PlaySessionReporter,
  StartPayload,
  ProgressPayload,
  CompletePayload,
} from "@repo/experience-engine";

/**
 * No-op play session reporter for Studio playtest.
 *
 * Draft playtests reference film builds that are typically not yet published
 * in the Java play-session service. Calling /api/player/play/sessions/start
 * would fail with a 4xx. Skip reporting entirely for drafts.
 */
export function createNoopPlaySessionReporter(): PlaySessionReporter {
  return {
    async onStart(_payload: StartPayload): Promise<null> {
      return null;
    },
    async onProgress(_sessionId: string, _payload: ProgressPayload): Promise<void> {
      // no-op
    },
    async onComplete(_sessionId: string, _payload: CompletePayload): Promise<void> {
      // no-op
    },
  };
}
