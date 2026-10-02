import { useLayoutEffect, useRef, useState } from "react";
import type { PlaySessionReporter } from "@repo/experience-engine";

/** Reporting callback identity must never reset playback. Bind each started
 * session to its original transport; changed callbacks apply to the next start. */
export function usePlaySessionReporter(reporter: PlaySessionReporter | undefined) {
  const current = useRef(reporter);
  useLayoutEffect(() => {
    current.current = reporter;
  }, [reporter]);
  const [stable] = useState<PlaySessionReporter>(() => {
    const sessions = new Map<string, PlaySessionReporter>();
    return {
      async onStart(payload) {
        const transport = current.current;
        if (!transport) return null;
        const result = await transport.onStart(payload);
        if (result) sessions.set(result.sessionId, transport);
        return result;
      },
      async onProgress(sessionId, payload) {
        await sessions.get(sessionId)?.onProgress(sessionId, payload);
      },
      async onComplete(sessionId, payload) {
        const transport = sessions.get(sessionId);
        await transport?.onComplete(sessionId, payload);
        sessions.delete(sessionId);
      },
    };
  });
  return stable;
}
