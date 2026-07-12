import { INTERACTIVE_FILM_SESSION_SCHEMA_VERSION, type GameSession } from "../domain/session";
import type { SessionDecoder, SessionMigrator, SessionRepository, StorageLike } from "./repository";

const ENVELOPE_SCHEMA_VERSION = 1 as const;

type StoredEnvelope = {
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  activeSessionId: string | null;
  sessions: Record<string, unknown>;
};

export class LocalRepositoryError extends Error {
  constructor(
    readonly code:
      | "STORAGE_UNAVAILABLE"
      | "INVALID_DATA"
      | "WRITE_FAILED"
      | "CONTENT_VERSION_MISMATCH",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "LocalRepositoryError";
  }
}

export type LocalSessionRepositoryOptions<TProfile> = {
  gameId: string;
  releaseId: string;
  contentVersion: string;
  decodeSession: SessionDecoder<TProfile>;
  migrateSession?: SessionMigrator;
  storage?: StorageLike;
  namespace?: string;
};

function requireStableId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be a non-empty stable id`);
  return normalized;
}

function browserStorage(): StorageLike {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new LocalRepositoryError(
      "STORAGE_UNAVAILABLE",
      "Local session storage is unavailable in this environment"
    );
  }
  return window.localStorage;
}

export class LocalSessionRepository<TProfile> implements SessionRepository<TProfile> {
  private readonly storageKey: string;
  private readonly gameId: string;
  private readonly releaseId: string;
  private readonly contentVersion: string;
  private readonly decodeSession: SessionDecoder<TProfile>;
  private readonly migrateSession?: SessionMigrator;
  private readonly injectedStorage?: StorageLike;

  constructor(options: LocalSessionRepositoryOptions<TProfile>) {
    this.gameId = requireStableId(options.gameId, "gameId");
    this.releaseId = requireStableId(options.releaseId, "releaseId");
    this.contentVersion = requireStableId(options.contentVersion, "contentVersion");
    this.decodeSession = options.decodeSession;
    this.migrateSession = options.migrateSession;
    this.injectedStorage = options.storage;
    const namespace = options.namespace?.trim() || "fizzdragon:interactive-film";
    this.storageKey = `${namespace}:v${ENVELOPE_SCHEMA_VERSION}:${this.gameId}`;
  }

  async save(session: GameSession<TProfile>): Promise<void> {
    let validated: GameSession<TProfile>;
    try {
      validated = this.decodeSession(session);
      this.assertCompatible(validated);
    } catch (error) {
      if (error instanceof LocalRepositoryError) throw error;
      throw new LocalRepositoryError(
        "INVALID_DATA",
        `Session ${session.sessionId} failed validation before persistence`,
        { cause: error }
      );
    }
    const envelope = this.readEnvelope();
    envelope.sessions[validated.sessionId] = validated;
    envelope.activeSessionId = validated.sessionId;
    this.writeEnvelope(envelope);
  }

  async load(sessionId: string): Promise<GameSession<TProfile> | null> {
    const id = requireStableId(sessionId, "sessionId");
    const raw = this.readEnvelope().sessions[id];
    return raw === undefined ? null : this.decodeAndAssert(raw);
  }

  async loadActive(): Promise<GameSession<TProfile> | null> {
    const envelope = this.readEnvelope();
    if (!envelope.activeSessionId) return null;
    const raw = envelope.sessions[envelope.activeSessionId];
    if (raw === undefined) {
      throw new LocalRepositoryError(
        "INVALID_DATA",
        `Active session ${envelope.activeSessionId} is missing from the local envelope`
      );
    }
    return this.decodeAndAssert(raw);
  }

  async list(): Promise<GameSession<TProfile>[]> {
    const sessions = Object.values(this.readEnvelope().sessions).map((value) =>
      this.decodeAndAssert(value)
    );
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async setActive(sessionId: string | null): Promise<void> {
    const envelope = this.readEnvelope();
    if (sessionId === null) {
      envelope.activeSessionId = null;
      this.writeEnvelope(envelope);
      return;
    }
    const id = requireStableId(sessionId, "sessionId");
    if (!(id in envelope.sessions)) {
      throw new LocalRepositoryError("INVALID_DATA", `Cannot activate missing session ${id}`);
    }
    envelope.activeSessionId = id;
    this.writeEnvelope(envelope);
  }

  async delete(sessionId: string): Promise<void> {
    const id = requireStableId(sessionId, "sessionId");
    const envelope = this.readEnvelope();
    delete envelope.sessions[id];
    if (envelope.activeSessionId === id) envelope.activeSessionId = null;
    this.writeEnvelope(envelope);
  }

  async clear(): Promise<void> {
    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      throw new LocalRepositoryError(
        "WRITE_FAILED",
        `Unable to clear local session data for ${this.gameId}`,
        { cause: error }
      );
    }
  }

  private get storage(): StorageLike {
    return this.injectedStorage ?? browserStorage();
  }

  private emptyEnvelope(): StoredEnvelope {
    return {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      activeSessionId: null,
      sessions: {},
    };
  }

  private readEnvelope(): StoredEnvelope {
    const serialized = this.storage.getItem(this.storageKey);
    if (serialized === null) return this.emptyEnvelope();

    try {
      const parsed = JSON.parse(serialized) as Partial<StoredEnvelope>;
      if (
        parsed.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
        (parsed.activeSessionId !== null && typeof parsed.activeSessionId !== "string") ||
        !parsed.sessions ||
        typeof parsed.sessions !== "object" ||
        Array.isArray(parsed.sessions)
      ) {
        throw new Error("invalid local session envelope shape");
      }
      return parsed as StoredEnvelope;
    } catch (error) {
      throw new LocalRepositoryError(
        "INVALID_DATA",
        `Local session data for ${this.gameId} is invalid`,
        { cause: error }
      );
    }
  }

  private writeEnvelope(envelope: StoredEnvelope): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch (error) {
      throw new LocalRepositoryError(
        "WRITE_FAILED",
        `Unable to persist local session data for ${this.gameId}`,
        { cause: error }
      );
    }
  }

  private decodeAndAssert(raw: unknown): GameSession<TProfile> {
    try {
      const session = this.decodeSession(raw);
      this.assertCompatible(session);
      return session;
    } catch (initialError) {
      if (!this.migrateSession) {
        if (initialError instanceof LocalRepositoryError) throw initialError;
        throw new LocalRepositoryError(
          "INVALID_DATA",
          `Stored session for ${this.gameId} failed validation`,
          { cause: initialError }
        );
      }

      try {
        const migrated = this.migrateSession(raw, {
          gameId: this.gameId,
          releaseId: this.releaseId,
          contentVersion: this.contentVersion,
        });
        const session = this.decodeSession(migrated);
        this.assertCompatible(session);
        return session;
      } catch (migrationError) {
        if (migrationError instanceof LocalRepositoryError) throw migrationError;
        throw new LocalRepositoryError(
          "INVALID_DATA",
          `Stored session for ${this.gameId} could not be migrated`,
          { cause: migrationError }
        );
      }
    }
  }

  private assertCompatible(session: GameSession<TProfile>): void {
    if (
      session.schemaVersion !== INTERACTIVE_FILM_SESSION_SCHEMA_VERSION ||
      session.gameId !== this.gameId ||
      session.releaseId !== this.releaseId ||
      session.contentVersion !== this.contentVersion
    ) {
      throw new LocalRepositoryError(
        "CONTENT_VERSION_MISMATCH",
        `Session ${session.sessionId} is incompatible with ${this.gameId} ${this.releaseId}/${this.contentVersion}`
      );
    }
  }
}
