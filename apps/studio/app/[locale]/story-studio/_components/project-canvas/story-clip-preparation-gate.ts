export type StoryClipPreparationAttemptStatus = "pending" | "succeeded" | "failed";

export interface StoryClipPreparationAttempt {
  key: string;
  status: StoryClipPreparationAttemptStatus;
}

export function shouldPrepareStoryClip(input: {
  graphNodeId: string | null;
  hasMaterializedClip: boolean;
  masterDirection: string | null;
  canGenerate: boolean;
  draftSettled: boolean;
  draftRevision: number;
}): boolean {
  return Boolean(
    input.graphNodeId &&
    !input.hasMaterializedClip &&
    input.masterDirection?.trim() &&
    input.canGenerate &&
    input.draftSettled &&
    input.draftRevision >= 1
  );
}

/**
 * Keeps automatic clip preparation bounded to one attempt per exact draft.
 *
 * A graph node may be selected repeatedly and React effects may be replayed in
 * development. Pending attempts therefore suppress every duplicate, while a
 * failed or successful attempt suppresses only the same immutable input key.
 * A newer draft key can start once the previous request has settled.
 */
export class StoryClipPreparationGate {
  private readonly attempts = new Map<string, StoryClipPreparationAttempt>();

  tryStart(graphNodeId: string, key: string): boolean {
    const current = this.attempts.get(graphNodeId);
    if (current?.status === "pending" || current?.key === key) return false;
    this.attempts.set(graphNodeId, { key, status: "pending" });
    return true;
  }

  rekey(graphNodeId: string, currentKey: string, exactKey: string): boolean {
    const current = this.attempts.get(graphNodeId);
    if (current?.status !== "pending" || current.key !== currentKey) return false;
    this.attempts.set(graphNodeId, { key: exactKey, status: "pending" });
    return true;
  }

  settle(
    graphNodeId: string,
    key: string,
    status: Exclude<StoryClipPreparationAttemptStatus, "pending">
  ): boolean {
    const current = this.attempts.get(graphNodeId);
    if (current?.status !== "pending" || current.key !== key) return false;
    this.attempts.set(graphNodeId, { key, status });
    return true;
  }

  get(graphNodeId: string): StoryClipPreparationAttempt | null {
    return this.attempts.get(graphNodeId) ?? null;
  }
}
