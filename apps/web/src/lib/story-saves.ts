import { api, ApiRequestError } from "@/src/lib/api/api-client";
import { SESSION_COOKIE_NAME } from "@/src/lib/auth/protected-paths";
import {
  ExperienceJourneySchema,
  type ExperienceJourney,
  type ExperienceJourneyDelta,
} from "@repo/shared/experience-runtime";
import { applyExperienceJourneyDelta, diffExperienceJourney } from "@repo/experience-engine";

/**
 * Client for /aurora/story-saves — interactive-film play saves (存档).
 * One "current run" slot per (user, game, chapter); `chapterId` is "" for
 * single-chapter works. Auth rides the satoken cookie. Reads and conditional
 * writes are serialized for each account session and chapter.
 */

export interface StorySave {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown[];
  playback?: unknown;
  journey?: ExperienceJourney;
  revision: number;
  updatedAt: string;
}

export interface SavePayload {
  contentVersion: string;
  state: unknown;
  events: unknown[];
  playback?: unknown;
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
type SaveAck = { saved: true; updatedAt: string; revision: number };
type ClearAck = { cleared: true; revision: number };

function slotPath(gameId: string, chapterId: string): string {
  const base = `/aurora/story-saves/${encodeURIComponent(gameId)}/save`;
  return chapterId ? `${base}?chapterId=${encodeURIComponent(chapterId)}` : base;
}

/** Most recently played chapter's save — the "continue playing" pointer. */
export async function fetchLatestSave(
  gameId: string,
  signal?: AbortSignal
): Promise<StorySave | null> {
  const owner = scope;
  if (owner && ownsScope(owner)) {
    await Promise.all(
      [...owner.channels.values()]
        .filter((channel) => channel.gameId === gameId)
        .map((channel) => channel.settled())
    );
    assertScope(owner);
  }
  const save = await api.get<StorySave | null>(
    `/aurora/story-saves/${encodeURIComponent(gameId)}/latest`,
    { cache: "no-store", signal }
  );
  return save ?? null;
}

async function fetchChapterSave(
  gameId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StorySaveSlot> {
  const slot = await api.get<StorySaveSlot>(slotPath(gameId, chapterId), {
    cache: "no-store",
    signal,
  });
  return slot;
}

async function putChapterSave(
  gameId: string,
  chapterId: string,
  payload: Omit<SavePayload, "journey"> & { journeyDelta?: ExperienceJourneyDelta },
  expectedRevision: number,
  signal: AbortSignal,
  keepalive: boolean
): Promise<SaveAck> {
  return api.put<SaveAck>(slotPath(gameId, chapterId), {
    data: { ...payload, expectedRevision },
    signal,
    keepalive:
      keepalive &&
      new TextEncoder().encode(JSON.stringify({ ...payload, expectedRevision })).byteLength <=
        60_000,
  });
}

async function clearChapterSave(
  gameId: string,
  chapterId: string,
  expectedRevision: number,
  signal: AbortSignal
): Promise<ClearAck> {
  return api.delete<ClearAck>(slotPath(gameId, chapterId), {
    params: { expectedRevision },
    signal,
  });
}

type SaveScope = {
  id: number;
  accountId: string;
  cookie: string;
  controller: AbortController;
  channels: Map<string, StorySaveChannel>;
};
let scope: SaveScope | null = null;
let nextScopeId = 0;

export function readStorySaveSession(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? ""
  );
}
function ownsScope(owner: SaveScope): boolean {
  return !owner.controller.signal.aborted && owner.cookie === readStorySaveSession();
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
  const cookie = readStorySaveSession();
  if (
    !scope ||
    scope.controller.signal.aborted ||
    scope.accountId !== accountId ||
    scope.cookie !== cookie
  ) {
    scope?.controller.abort();
    scope = {
      id: ++nextScopeId,
      accountId,
      cookie,
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

/** The account/chapter writer survives SPA navigation without persisting credentials or an offline queue. */
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
    const result = await fetchChapterSave(
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
    keepalive = false,
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
          const result = await putChapterSave(
            this.gameId,
            this.chapterId,
            { ...checkpoint, ...(journeyDelta ? { journeyDelta } : {}) },
            expectedRevision,
            this.owner.controller.signal,
            keepalive
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
        const result = await clearChapterSave(
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
