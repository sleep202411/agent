"use client";

/**
 * useConsult — call a single persona agent synchronously, outside of
 * the chat composer's WS / message-history flow.
 *
 * The Produce wizard is intentionally NOT routed through the chat
 * pipeline: each step's consult is a one-shot question, the result
 * lives in step-local state, and committing produces a CRUD write
 * (batch_create_*) that doesn't need to be replayed as a chat
 * message. Going through `submit-message-to-agent` would pollute
 * chat history with synthetic user / assistant turns the user never
 * actually had a conversation about.
 *
 * Server endpoint contract (to be implemented as
 * `POST /aurora/assistant/consult`):
 *   request: { projectId, persona, task, context? }
 *   response: { summary: string, fields?: Record<string, unknown> | null,
 *               tookMs: number }
 *   - persona: one of the ForcedPersonaKey values from @repo/shared
 *   - task: free-form user prompt
 *   - context: optional workspace context, mirrored from the chat path
 *
 * MVP: the hook returns a typed-but-stubbed surface so the step UIs
 * can be built against it before the endpoint exists. Replace the
 * `consult` body with a real fetch once the controller lands.
 */
import { useCallback, useState } from "react";
import type { ForcedPersonaKey } from "@repo/shared";

export interface ConsultRequest {
  projectId: string;
  persona: ForcedPersonaKey;
  task: string;
  context?: Record<string, unknown>;
}

export interface ConsultResult {
  summary: string;
  fields?: Record<string, unknown> | null;
  tookMs: number;
}

export interface UseConsultReturn {
  consult: (req: ConsultRequest) => Promise<ConsultResult | null>;
  result: ConsultResult | null;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

export function useConsult(): UseConsultReturn {
  const [result, setResult] = useState<ConsultResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consult = useCallback(async (req: ConsultRequest): Promise<ConsultResult | null> => {
    setLoading(true);
    setError(null);
    try {
      // TODO(produce-mvp): replace stub with real call once
      // /aurora/assistant/consult is implemented server-side.
      // const res = await fetch("/aurora/assistant/consult", {
      //   method: "POST",
      //   credentials: "include",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify(req),
      // });
      // if (!res.ok) throw new Error(`consult failed: HTTP ${res.status}`);
      // const body = (await res.json()) as ConsultResult;
      // setResult(body);
      // return body;

      // Stub: simulate latency + canned response so step UIs render.
      await new Promise((r) => setTimeout(r, 400));
      const stub: ConsultResult = {
        summary: `[stub] ${req.persona} → ${req.task}`,
        fields: null,
        tookMs: 400,
      };
      setResult(stub);
      return stub;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { consult, result, loading, error, reset };
}
