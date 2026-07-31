import type { AgentAttachmentSummary } from "@repo/shared/agent-platform";

export const AGENT_ATTACHMENT_STATUS_BACKOFF_MS = [250, 500, 1_000, 2_000, 3_000] as const;

export class AgentAttachmentIngestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable: boolean }) {
    super(input.message);
    this.name = "AgentAttachmentIngestError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

/**
 * Waits for one registered attachment to become model-readable.
 *
 * This never scans attachment history and never imposes a browser timeout on a
 * durable ingest. Closing/removing the chip aborts immediately; background
 * tabs stop generating status traffic until they become visible again.
 */
export async function waitForAgentAttachmentReady({
  initial,
  readStatus,
  signal,
  onStatus,
  visibility = browserVisibility,
  delay = abortableDelay,
}: {
  initial: AgentAttachmentSummary;
  readStatus: (signal: AbortSignal) => Promise<AgentAttachmentSummary>;
  signal: AbortSignal;
  onStatus?: (summary: AgentAttachmentSummary) => void;
  visibility?: AgentAttachmentVisibility;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<AgentAttachmentSummary> {
  let current = initial;
  let attempt = 0;
  onStatus?.(current);

  while (true) {
    throwIfAborted(signal);
    if (current.status === "ready") return current;
    if (current.status === "failed" || current.status === "revoked") {
      throw attachmentFailure(current);
    }

    await visibility.waitUntilVisible(signal);
    await delay(
      AGENT_ATTACHMENT_STATUS_BACKOFF_MS[
        Math.min(attempt, AGENT_ATTACHMENT_STATUS_BACKOFF_MS.length - 1)
      ]!,
      signal
    );
    await visibility.waitUntilVisible(signal);
    try {
      current = await readStatus(signal);
      onStatus?.(current);
      attempt = Math.min(attempt + 1, AGENT_ATTACHMENT_STATUS_BACKOFF_MS.length - 1);
    } catch (cause) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      // Network/service turbulence must not turn a durable background job into
      // a failed upload. Keep the chip in processing and reconcile again with
      // the same bounded backoff.
      if (cause instanceof AgentAttachmentIngestError) throw cause;
      attempt = Math.min(attempt + 1, AGENT_ATTACHMENT_STATUS_BACKOFF_MS.length - 1);
    }
  }
}

export interface AgentAttachmentVisibility {
  waitUntilVisible(signal: AbortSignal): Promise<void>;
}

const browserVisibility: AgentAttachmentVisibility = {
  waitUntilVisible(signal) {
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onVisibility = () => {
        if (document.visibilityState === "hidden") return;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        signal.removeEventListener("abort", onAbort);
      };
      document.addEventListener("visibilitychange", onVisibility);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
};

function attachmentFailure(summary: AgentAttachmentSummary): AgentAttachmentIngestError {
  return new AgentAttachmentIngestError(
    summary.error ?? {
      code:
        summary.status === "revoked"
          ? "agent.attachment_revoked"
          : "agent.attachment_processing_failed",
      message:
        summary.status === "revoked"
          ? "The attachment is no longer available."
          : "The attachment could not be processed.",
      retryable: summary.status !== "revoked",
    }
  );
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}
