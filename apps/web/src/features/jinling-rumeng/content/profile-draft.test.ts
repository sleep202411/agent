import assert from "node:assert/strict";
import test from "node:test";
import type { StorageLike } from "@/src/features/interactive-film/persistence/repository";
import {
  completeJinlingProfileDraft,
  createEmptyJinlingProfileDraft,
  JinlingProfileDraftError,
  JinlingProfileDraftRepository,
} from "./profile-draft";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("persists and restores an incomplete profile draft", () => {
  const repository = new JinlingProfileDraftRepository(new MemoryStorage());
  const draft = {
    ...createEmptyJinlingProfileDraft("2026-07-11T12:00:00.000Z"),
    displayName: "无名客",
    origin: "weave" as const,
  };

  repository.save(draft);

  assert.deepEqual(repository.load(), draft);
  assert.equal(completeJinlingProfileDraft(draft), null);
});

test("turns a fully authored draft into a player profile", () => {
  const profile = completeJinlingProfileDraft({
    ...createEmptyJinlingProfileDraft("2026-07-11T12:00:00.000Z"),
    displayName: "  云舟  ",
    origin: "medic",
    trait: "careful",
  });

  assert.deepEqual(profile, {
    displayName: "云舟",
    origin: "medic",
    trait: "careful",
  });
});

test("fails loud for corrupt local draft data and can be cleared", () => {
  const storage = new MemoryStorage();
  const repository = new JinlingProfileDraftRepository(storage);
  storage.setItem("fizzdragon:interactive-film:draft:v1:jinling-rumeng", "not-json");

  assert.throws(() => repository.load(), JinlingProfileDraftError);
  repository.clear();
  assert.equal(repository.load(), null);
});
