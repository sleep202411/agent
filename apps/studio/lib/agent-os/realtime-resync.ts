import type { AgentOsAblyResyncPointer } from "@repo/shared";

export type AgentOsSequencedEvent = {
  id: string;
  sequence: number;
};

export type AgentOsJournalCatchUpTarget = {
  runId: string;
  conversationId: string;
  sequence: number;
  /** The publisher-provided upper bound for the HTTP `after` cursor. */
  afterSequence: number;
  eventId?: string;
};

export type AgentOsJournalWatermarkCatchUp = {
  runId: string;
  conversationId: string;
  afterSequence: number;
};

type AgentOsJournalCatchUpPage = {
  runId: string;
  events: readonly AgentOsSequencedEvent[];
};

type AgentOsConversationHistoryPage = {
  conversationId: string | null;
};

export function agentOsCatchUpTargetFromPointer(
  pointer: AgentOsAblyResyncPointer
): AgentOsJournalCatchUpTarget {
  return {
    runId: pointer.runId,
    conversationId: pointer.conversationId,
    sequence: pointer.sequence,
    afterSequence: pointer.afterSequence,
    eventId: pointer.kind !== "snapshot_oversized" ? pointer.eventId : undefined,
  };
}

export function agentOsCatchUpTargetFromEventGap(
  event: AgentOsSequencedEvent & { runId: string; conversationId: string },
  localContiguous: number
): AgentOsJournalCatchUpTarget | null {
  if (event.sequence <= localContiguous + 1) return null;
  return {
    runId: event.runId,
    conversationId: event.conversationId,
    sequence: event.sequence,
    afterSequence: localContiguous,
    eventId: event.id,
  };
}

export function agentOsCatchUpTargetFromSnapshot(
  snapshot: { runId: string; conversationId: string; lastSequence: number },
  localContiguous: number
): AgentOsJournalCatchUpTarget | null {
  if (snapshot.lastSequence <= localContiguous) return null;
  return {
    runId: snapshot.runId,
    conversationId: snapshot.conversationId,
    sequence: snapshot.lastSequence,
    afterSequence: localContiguous,
  };
}

/**
 * Advances only through a contiguous prefix. A higher realtime sequence must
 * never become the HTTP replay cursor while an earlier event is missing.
 */
export function advanceAgentOsContiguousSequence(
  eventsBySequence: ReadonlyMap<number, unknown>,
  current = 0
): number {
  let contiguous = Math.max(0, current);
  while (eventsBySequence.has(contiguous + 1)) contiguous += 1;
  return contiguous;
}

/**
 * An explicit pointer says N-1 is sufficient only when the browser already
 * owns the earlier prefix. A disconnected client may be further behind, so
 * always choose the earlier durable contiguous cursor.
 */
export function agentOsCatchUpAfterSequence(
  localContiguous: number,
  publisherAfterSequence: number
): number {
  return Math.max(0, Math.min(localContiguous, publisherAfterSequence));
}

/**
 * Deduplicates realtime resync nudges and keeps retrying the authoritative HTTP
 * journal until the target sequence is present. Ably is an accelerator only;
 * a lost pointer response must not become a permanent transcript gap.
 */
export class AgentOsRealtimeResyncPuller<TPage extends AgentOsJournalCatchUpPage> {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private disposed = false;

  constructor(
    private readonly load: (
      target: AgentOsJournalCatchUpTarget,
      afterSequence: number,
      signal: AbortSignal
    ) => Promise<TPage>,
    private readonly accept: (page: TPage) => void,
    private readonly contiguousSequence: (runId: string) => number,
    private readonly retryDelay: (
      attempt: number,
      signal: AbortSignal
    ) => Promise<void> = defaultRetryDelay
  ) {}

  request(target: AgentOsJournalCatchUpTarget): Promise<void> {
    if (this.disposed || this.contiguousSequence(target.runId) >= target.sequence) {
      return Promise.resolve();
    }
    const key = `${target.runId}:${target.sequence}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    this.controllers.add(controller);
    const fixedAfterSequence = agentOsCatchUpAfterSequence(
      this.contiguousSequence(target.runId),
      target.afterSequence
    );
    const pending = this.pull(target, fixedAfterSequence, controller.signal).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
      this.controllers.delete(controller);
    });
    this.pending.set(key, pending);
    return pending;
  }

  requestWatermark(input: AgentOsJournalWatermarkCatchUp): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const afterSequence = Math.max(0, input.afterSequence);
    const key = `watermark:${input.runId}:${afterSequence}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    this.controllers.add(controller);
    const target = {
      ...input,
      afterSequence,
      sequence: afterSequence + 1,
    } satisfies AgentOsJournalCatchUpTarget;
    const pending = this.pullWatermark(target, controller.signal).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
      this.controllers.delete(controller);
    });
    this.pending.set(key, pending);
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  reset(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.pending.clear();
  }

  private async pull(
    target: AgentOsJournalCatchUpTarget,
    afterSequence: number,
    signal: AbortSignal
  ): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      if (this.contiguousSequence(target.runId) >= target.sequence) return;
      try {
        const page = await this.load(target, afterSequence, signal);
        if (signal.aborted) return;
        if (page.runId !== target.runId) {
          throw new Error("Agent OS resync returned another run");
        }
        if (
          target.eventId &&
          !page.events.some(
            (event) => event.sequence === target.sequence && event.id === target.eventId
          )
        ) {
          throw new Error("Agent OS resync response is missing the pointed event");
        }
        this.accept(page);
        if (this.contiguousSequence(target.runId) >= target.sequence) {
          return;
        }
      } catch {
        if (signal.aborted) return;
      }
      attempt += 1;
      await this.retryDelay(attempt, signal);
    }
  }

  private async pullWatermark(
    target: AgentOsJournalCatchUpTarget,
    signal: AbortSignal
  ): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const page = await this.load(target, target.afterSequence, signal);
        if (signal.aborted) return;
        if (page.runId !== target.runId) {
          throw new Error("Agent OS resync returned another run");
        }
        this.accept(page);
        return;
      } catch {
        if (signal.aborted) return;
      }
      attempt += 1;
      await this.retryDelay(attempt, signal);
    }
  }
}

/**
 * A channel discontinuity can hide a whole run whose id this tab never saw.
 * Reconcile at conversation scope first; per-run sequence repair alone cannot
 * discover that run. Existing optimistic rows are owned by the hook and are
 * merged, never cleared, by the accept callback.
 */
export class AgentOsRealtimeConversationReconciler<TPage extends AgentOsConversationHistoryPage> {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private disposed = false;

  constructor(
    private readonly load: (conversationId: string, signal: AbortSignal) => Promise<TPage>,
    private readonly accept: (page: TPage) => void,
    private readonly retryDelay: (
      attempt: number,
      signal: AbortSignal
    ) => Promise<void> = defaultRetryDelay
  ) {}

  request(conversationId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.pending.get(conversationId);
    if (existing) return existing;
    const controller = new AbortController();
    this.controllers.add(controller);
    const pending = this.reconcile(conversationId, controller.signal).finally(() => {
      if (this.pending.get(conversationId) === pending) {
        this.pending.delete(conversationId);
      }
      this.controllers.delete(controller);
    });
    this.pending.set(conversationId, pending);
    return pending;
  }

  reset(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private async reconcile(conversationId: string, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const page = await this.load(conversationId, signal);
        if (signal.aborted) return;
        if (page.conversationId !== null && page.conversationId !== conversationId) {
          throw new Error("Agent OS reconciliation returned another conversation");
        }
        this.accept(page);
        return;
      } catch {
        if (signal.aborted) return;
      }
      attempt += 1;
      await this.retryDelay(attempt, signal);
    }
  }
}

async function defaultRetryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const delayMs = Math.min(250 * 2 ** Math.min(attempt - 1, 7), 30_000);
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
