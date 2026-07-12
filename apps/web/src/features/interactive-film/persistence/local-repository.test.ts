import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERACTIVE_FILM_SESSION_SCHEMA_VERSION,
  createGameSession,
  type GameSession,
} from "../domain/session";
import { LocalRepositoryError, LocalSessionRepository } from "./local-repository";
import type { StorageLike } from "./repository";

type Profile = { origin: "weave" | "kin" | "medic" };

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function decodeSession(input: unknown): GameSession<Profile> {
  if (!input || typeof input !== "object") throw new Error("not an object");
  const session = input as Partial<GameSession<Profile>>;
  if (
    session.schemaVersion !== INTERACTIVE_FILM_SESSION_SCHEMA_VERSION ||
    typeof session.sessionId !== "string" ||
    typeof session.gameId !== "string" ||
    typeof session.releaseId !== "string" ||
    typeof session.contentVersion !== "string" ||
    !session.profile
  ) {
    throw new Error("invalid session");
  }
  return session as GameSession<Profile>;
}

function makeRepository(storage: MemoryStorage, contentVersion = "2026.07.11.1") {
  return new LocalSessionRepository<Profile>({
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion,
    decodeSession,
    storage,
  });
}

function makeSession(id: string, updatedAt: string) {
  const session = createGameSession<Profile>({
    sessionId: id,
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion: "2026.07.11.1",
    profile: { origin: "kin" },
    startNodeId: "S01-P00",
    now: updatedAt,
  });
  return session;
}

test("persists, restores, orders, activates and deletes sessions", async () => {
  const storage = new MemoryStorage();
  const repository = makeRepository(storage);
  const first = makeSession("session-001", "2026-07-11T10:00:00.000Z");
  const second = makeSession("session-002", "2026-07-11T11:00:00.000Z");

  await repository.save(first);
  await repository.save(second);

  assert.deepEqual(
    (await repository.list()).map((session) => session.sessionId),
    ["session-002", "session-001"]
  );
  assert.equal((await repository.loadActive())?.sessionId, "session-002");

  await repository.setActive("session-001");
  assert.equal((await repository.loadActive())?.sessionId, "session-001");
  assert.deepEqual(await repository.load("missing"), null);

  await repository.delete("session-001");
  assert.equal(await repository.loadActive(), null);
  assert.equal(await repository.load("session-001"), null);
});

test("preserves pending choice transactions across reload", async () => {
  const storage = new MemoryStorage();
  const repository = makeRepository(storage);
  const session = makeSession("session-001", "2026-07-11T10:00:00.000Z");
  session.pendingChoice = {
    transactionId: "txn-001",
    nodeId: "S01-SC08-WAIT",
    choiceId: "Q08-A",
    actionId: "POV-CATCH-JADE",
    nextNodeId: "S01-SC08-Q08-A",
    committedAt: "2026-07-11T10:01:00.000Z",
  };

  await repository.save(session);
  const restored = await repository.loadActive();

  assert.equal(restored?.pendingChoice?.transactionId, "txn-001");
  assert.equal(restored?.pendingChoice?.actionId, "POV-CATCH-JADE");
});

test("fails loud on incompatible content and corrupt storage", async () => {
  const storage = new MemoryStorage();
  const repository = makeRepository(storage);
  await repository.save(makeSession("session-001", "2026-07-11T10:00:00.000Z"));

  const futureRepository = makeRepository(storage, "2026.07.12.1");
  await assert.rejects(
    () => futureRepository.loadActive(),
    (error: unknown) =>
      error instanceof LocalRepositoryError && error.code === "CONTENT_VERSION_MISMATCH"
  );

  const corruptStorage = new MemoryStorage();
  corruptStorage.setItem("fizzdragon:interactive-film:v1:jinling-rumeng", "not-json");
  await assert.rejects(
    () => makeRepository(corruptStorage).list(),
    (error: unknown) => error instanceof LocalRepositoryError && error.code === "INVALID_DATA"
  );
});

test("uses an explicit content migration and validates the migrated result", async () => {
  const storage = new MemoryStorage();
  const oldRepository = makeRepository(storage);
  await oldRepository.save(makeSession("session-001", "2026-07-11T10:00:00.000Z"));

  const repository = new LocalSessionRepository<Profile>({
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion: "2026.07.12.1",
    decodeSession,
    storage,
    migrateSession: (input, target) => ({
      ...(input as GameSession<Profile>),
      gameId: target.gameId,
      releaseId: target.releaseId,
      contentVersion: target.contentVersion,
      updatedAt: "2026-07-12T09:00:00.000Z",
    }),
  });

  const migrated = await repository.loadActive();
  assert.equal(migrated?.contentVersion, "2026.07.12.1");
  assert.equal(migrated?.updatedAt, "2026-07-12T09:00:00.000Z");
});

test("validates sessions before writing them", async () => {
  const storage = new MemoryStorage();
  const repository = new LocalSessionRepository<Profile>({
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion: "2026.07.11.1",
    storage,
    decodeSession: (input) => {
      const session = decodeSession(input);
      if (session.stableCheckpoint.historyIndex >= session.history.length) {
        throw new Error("invalid checkpoint");
      }
      return session;
    },
  });
  const session = makeSession("session-001", "2026-07-11T10:00:00.000Z");
  session.stableCheckpoint.historyIndex = 99;

  await assert.rejects(
    () => repository.save(session),
    (error: unknown) => error instanceof LocalRepositoryError && error.code === "INVALID_DATA"
  );
  assert.equal(storage.data.size, 0);
});

test("clears the complete local session envelope", async () => {
  const storage = new MemoryStorage();
  const repository = makeRepository(storage);
  await repository.save(makeSession("session-clear", "2026-07-11T10:00:00.000Z"));

  await repository.clear();

  assert.equal(await repository.loadActive(), null);
  assert.deepEqual(await repository.list(), []);
});
