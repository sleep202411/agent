import type { GameSession } from "../domain/session";

export type SessionDecoder<TProfile> = (input: unknown) => GameSession<TProfile>;

export type SessionMigrationTarget = {
  gameId: string;
  releaseId: string;
  contentVersion: string;
};

export type SessionMigrator = (input: unknown, target: SessionMigrationTarget) => unknown;

export interface SessionRepository<TProfile> {
  save(session: GameSession<TProfile>): Promise<void>;
  load(sessionId: string): Promise<GameSession<TProfile> | null>;
  loadActive(): Promise<GameSession<TProfile> | null>;
  list(): Promise<GameSession<TProfile>[]>;
  setActive(sessionId: string | null): Promise<void>;
  delete(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
