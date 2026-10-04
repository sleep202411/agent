import { applyExperienceJourneyDelta, diffExperienceJourney } from "@repo/experience-engine";
import { ExperienceJourneySchema, type ExperienceJourney } from "@repo/shared/experience-runtime";

import { getAuthGeneration } from "@/auth/auth-store";
import { ApiRequestError } from "@/lib/api-client";

import { createStorySavesApi, type StorySave, type StorySaveWrite } from "../api/story-saves-api";
export type { StorySave } from "../api/story-saves-api";

/** Account-scoped, serialized chapter saves using the official Web coordinator semantics. */
export interface SavePayload {
  contentVersion: string;
  state: StorySaveWrite["state"];
  events: StorySaveWrite["events"];
  playback?: StorySaveWrite["playback"];
  journey?: ExperienceJourney;
}

export interface StorySaveSlot {
  save: StorySave | null;
  revision: number;
}
export type StorySaveStatus = {
  phase: "idle" | "pending" | "saving" | "saved" | "error" | "conflict";
  error: string | null;
};
type SaveScope = {
  id: number;
  accountId: string;
  generation: number;
  api: ReturnType<typeof createStorySavesApi>;
  controller: AbortController;
  channels: Map<string, StorySaveChannel>;
};
let scope: SaveScope | null = null;
let nextScopeId = 0;

function ownsScope(owner: SaveScope): boolean {
  return !owner.controller.signal.aborted && owner.generation === getAuthGeneration();
}
function assertScope(owner: SaveScope): void {
  if (!ownsScope(owner)) {
    owner.controller.abort();
    throw new DOMException("Save session changed", "AbortError");
  }
}
function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid save revision.");
  return value;
}
function isConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}
const CONFLICT_MESSAGE = "Save has changed. Reload the latest save before trying again.";

function accountScope(accountId: string): SaveScope {
  const generation = getAuthGeneration();
  if (
    !scope ||
    scope.controller.signal.aborted ||
    scope.accountId !== accountId ||
    scope.generation !== generation
  ) {
    scope?.controller.abort();
    scope = {
      id: ++nextScopeId,
      accountId,
      generation,
      api: createStorySavesApi(),
      controller: new AbortController(),
      channels: new Map(),
    };
  }
  return scope;
}

/** A private session generation lets the UI remount without using a credential as its key. */
export function getStorySaveSessionId(accountId: string): number {
  return accountScope(accountId).id;
}

/** Wait for this account's chapter writes before resolving the continue-playing pointer. */
export async function fetchLatestSave(
  accountId: string,
  gameId: string,
  signal?: AbortSignal
): Promise<StorySave | null> {
  const owner = accountScope(accountId);
  signal?.throwIfAborted();
  await Promise.all(
    [...owner.channels.values()]
      .filter((channel) => channel.gameId === gameId)
      .map((channel) => channel.settled())
  );
  assertScope(owner);
  const result = await owner.api.latest(gameId, signal ?? owner.controller.signal);
  assertScope(owner);
  return result;
}

/** The account/chapter writer survives Mobile navigation without persisting credentials or an offline queue. */
export function getStorySaveChannel(
  accountId: string,
  gameId: string,
  chapterId: string
): StorySaveChannel {
  const owner = accountScope(accountId);
  const key = JSON.stringify([gameId, chapterId]);
  let channel = owner.channels.get(key);
  if (!channel) {
    channel = new StorySaveChannel(owner, gameId, chapterId);
    owner.channels.set(key, channel);
  }
  return channel;
}

/** Explicit conflict recovery rereads this session's affected chapter slots. */
export async function reloadStorySaveGame(
  accountId: string,
  gameId: string,
  signal?: AbortSignal
): Promise<void> {
  const owner = scope;
  if (!owner || owner.accountId !== accountId)
    throw new DOMException("Save session changed", "AbortError");
  assertScope(owner);
  for (const channel of owner.channels.values()) {
    if (channel.gameId === gameId) await channel.reload(signal);
  }
}

export class StorySaveChannel {
  private tail: Promise<unknown> = Promise.resolve();
  private currentRevision: number | null = null;
  private pending: { payload: SavePayload; sequence: number } | null = null;
  private sequence = 0;
  private acknowledgedJourney: ExperienceJourney | null = null;
  private status: StorySaveStatus = { phase: "idle", error: null };
  private listeners = new Set<(status: StorySaveStatus) => void>();
  constructor(
    private readonly owner: SaveScope,
    readonly gameId: string,
    readonly chapterId: string
  ) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => {
      assertScope(this.owner);
      return operation();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  settled(): Promise<void> {
    return this.tail.then(() => {});
  }
  ownsSession(): boolean {
    return ownsScope(this.owner);
  }
  getStatus(): StorySaveStatus {
    return this.status;
  }
  getRevision(): number {
    if (this.currentRevision === null) throw new Error("Save revision has not been read.");
    return this.currentRevision;
  }
  getPending(): SavePayload | null {
    return this.pending?.payload ?? null;
  }
  subscribe(listener: (status: StorySaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(phase: StorySaveStatus["phase"], error: string | null = null): void {
    if (this.status.phase === phase && this.status.error === error) return;
    this.status = { phase, error };
    if (ownsScope(this.owner)) for (const listener of this.listeners) listener(this.status);
  }
  private acceptRevision(next: number): void {
    revision(next);
    if (this.currentRevision !== null && next < this.currentRevision)
      throw new Error("Save revision moved backwards.");
    if (this.pending && this.currentRevision !== null && next !== this.currentRevision) {
      this.publish("conflict", CONFLICT_MESSAGE);
      throw new ApiRequestError("SAVE_CONFLICT", this.status.error!, 409);
    }
    this.currentRevision = revision(next);
  }
  private async readSlot(signal?: AbortSignal): Promise<StorySaveSlot> {
    signal?.throwIfAborted();
    const result = await this.owner.api.read(
      this.gameId,
      this.chapterId,
      signal ?? this.owner.controller.signal
    );
    signal?.throwIfAborted();
    assertScope(this.owner);
    if (
      result.save &&
      (result.save.gameId !== this.gameId ||
        result.save.chapterId !== this.chapterId ||
        result.save.revision !== result.revision)
    )
      throw new Error("Save does not match its chapter revision.");
    this.acceptRevision(result.revision);
    this.acknowledgedJourney = result.save?.journey
      ? ExperienceJourneySchema.parse(result.save.journey)
      : null;
    return result;
  }
  read(signal?: AbortSignal): Promise<StorySaveSlot> {
    return this.enqueue(() => this.readSlot(signal));
  }
  adopt(save: StorySave): void {
    assertScope(this.owner);
    if (save.gameId !== this.gameId || save.chapterId !== this.chapterId)
      throw new Error("Save belongs to another chapter.");
    this.acceptRevision(save.revision);
  }
  replace(payload: SavePayload): void {
    assertScope(this.owner);
    this.pending = { payload, sequence: ++this.sequence };
    if (this.status.phase === "idle" || this.status.phase === "saved") this.publish("pending");
  }
  flush(
    onWriting?: (payload: SavePayload, expectedRevision: number) => void
  ): Promise<{ payload: SavePayload; revision: number } | null> {
    return this.enqueue(async () => {
      if (!this.pending || this.status.phase === "conflict") return null;
      const pending = this.pending;
      try {
        if (this.currentRevision === null) await this.readSlot();
        assertScope(this.owner);
        this.publish("saving", this.status.error);
        const { journey, ...checkpoint } = pending.payload;
        let journeyDelta = journey
          ? diffExperienceJourney(this.acknowledgedJourney, journey)
          : undefined;
        do {
          const expectedRevision = this.currentRevision!;
          onWriting?.(pending.payload, expectedRevision);
          const result = await this.owner.api.write(
            this.gameId,
            this.chapterId,
            { ...checkpoint, ...(journeyDelta ? { journeyDelta } : {}), expectedRevision },
            this.owner.controller.signal
          );
          assertScope(this.owner);
          if (result.revision !== expectedRevision + 1)
            throw new Error("Invalid save acknowledgement revision.");
          this.currentRevision = revision(result.revision);
          if (journeyDelta)
            this.acknowledgedJourney = applyExperienceJourneyDelta(
              this.acknowledgedJourney,
              journeyDelta,
              { resetOnSignatureChange: true }
            );
          // Large offline histories take several bounded writes. A failed
          // later chunk retries only the entries the server hasn't acknowledged.
          journeyDelta = journey
            ? diffExperienceJourney(this.acknowledgedJourney, journey)
            : undefined;
        } while (journeyDelta);
        if (journey) this.acknowledgedJourney = journey;
        if (this.pending?.sequence === pending.sequence) this.pending = null;
        this.publish(this.pending ? "pending" : "saved");
        return { payload: pending.payload, revision: this.currentRevision };
      } catch (error) {
        if (ownsScope(this.owner))
          this.publish(
            isConflict(error) ? "conflict" : "error",
            error instanceof Error ? error.message : null
          );
        throw error;
      }
    });
  }
  /** Explicit recovery discards the unsaved local attempt before reading the authoritative checkpoint. */
  reload(signal?: AbortSignal): Promise<StorySaveSlot> {
    return this.enqueue(async () => {
      const previousPending = this.pending;
      this.pending = null;
      try {
        const result = await this.readSlot(signal);
        this.publish(result.save ? "saved" : "idle");
        return result;
      } catch (error) {
        if (!this.pending) this.pending = previousPending;
        throw error;
      }
    });
  }
  /** Conditional clear leaves a server revision tombstone to reject late writes. */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      if (this.status.phase === "conflict")
        throw new ApiRequestError("SAVE_CONFLICT", this.status.error ?? CONFLICT_MESSAGE, 409);
      const previousPending = this.pending;
      this.pending = null;
      try {
        if (this.currentRevision === null) await this.readSlot();
        assertScope(this.owner);
        const expectedRevision = this.currentRevision!;
        const result = await this.owner.api.clear(
          this.gameId,
          this.chapterId,
          expectedRevision,
          this.owner.controller.signal
        );
        assertScope(this.owner);
        if (result.revision !== expectedRevision + 1)
          throw new Error("Invalid save acknowledgement revision.");
        this.currentRevision = revision(result.revision);
        this.acknowledgedJourney = null;
        this.publish("idle");
      } catch (error) {
        if (!this.pending) this.pending = previousPending;
        if (ownsScope(this.owner))
          this.publish(
            isConflict(error) ? "conflict" : "error",
            error instanceof Error ? error.message : null
          );
        throw error;
      }
    });
  }
}
