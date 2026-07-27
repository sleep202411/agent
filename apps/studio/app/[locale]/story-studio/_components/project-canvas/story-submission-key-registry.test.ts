import { describe, expect, it } from "vitest";
import {
  StorySubmissionKeyRegistry,
  type StorySubmissionStorage,
} from "./story-submission-key-registry";

describe("StorySubmissionKeyRegistry", () => {
  it("reuses ambiguous submissions, rotates on input changes, and clears only confirmed input", async () => {
    const registry = new StorySubmissionKeyRegistry();
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;

    await expect(registry.keyFor("release", "build-a", createKey)).resolves.toBe("key-1");
    await expect(registry.keyFor("release", "build-a", createKey)).resolves.toBe("key-1");
    await expect(registry.keyFor("release", "build-b", createKey)).resolves.toBe("key-2");
    await registry.confirm("release", "build-a");
    await expect(registry.keyFor("release", "build-b", createKey)).resolves.toBe("key-2");
    await registry.confirm("release", "build-b");
    await expect(registry.keyFor("release", "build-b", createKey)).resolves.toBe("key-3");
  });

  it("persists only the SHA-256 fingerprint and recovers the key after a same-tab reload", async () => {
    const values = new Map<string, string>();
    const storage: StorySubmissionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const rawFingerprint = "private build payload";
    const storageKey = "project:publication:release";
    const first = new StorySubmissionKeyRegistry("project:publication", () => storage);
    await expect(first.keyFor("release", rawFingerprint, () => "persisted-key")).resolves.toBe(
      "persisted-key"
    );
    expect(JSON.parse(values.get(storageKey) ?? "null")).toEqual({
      fingerprintHash: "eb7c63d82eccb915a13f686010c08c4344b4a1549f5f8a750d5d9986dd08d3c1",
      key: "persisted-key",
    });
    expect(values.get(storageKey)).not.toContain(rawFingerprint);

    const afterReload = new StorySubmissionKeyRegistry("project:publication", () => storage);
    await expect(
      afterReload.keyFor("release", rawFingerprint, () => "duplicate-key")
    ).resolves.toBe("persisted-key");
    await afterReload.confirm("release", rawFingerprint);

    const afterConfirmation = new StorySubmissionKeyRegistry("project:publication", () => storage);
    await expect(
      afterConfirmation.keyFor("release", rawFingerprint, () => "rotated-key")
    ).resolves.toBe("rotated-key");
  });

  it("rejects and removes the former raw-fingerprint storage shape", async () => {
    const values = new Map([
      [
        "project:publication:release",
        JSON.stringify({ fingerprint: "raw private payload", key: "legacy-key" }),
      ],
    ]);
    const storage: StorySubmissionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const registry = new StorySubmissionKeyRegistry("project:publication", () => storage);

    await expect(registry.keyFor("release", "raw private payload", () => "new-key")).resolves.toBe(
      "new-key"
    );
    expect(JSON.parse(values.get("project:publication:release") ?? "null")).toMatchObject({
      fingerprintHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      key: "new-key",
    });
  });
});
