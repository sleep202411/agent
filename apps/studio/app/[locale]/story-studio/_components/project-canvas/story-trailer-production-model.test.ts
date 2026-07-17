import { describe, expect, it } from "vitest";
import {
  StorySubmissionKeyRegistry,
  type StorySubmissionStorage,
} from "./story-trailer-production-model";

describe("StorySubmissionKeyRegistry", () => {
  it("reuses ambiguous submissions, rotates on input changes, and clears only confirmed input", async () => {
    const registry = new StorySubmissionKeyRegistry();
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;

    await expect(registry.keyFor("trailer", "model-a", createKey)).resolves.toBe("key-1");
    await expect(registry.keyFor("trailer", "model-a", createKey)).resolves.toBe("key-1");
    await expect(registry.keyFor("trailer", "model-b", createKey)).resolves.toBe("key-2");
    await registry.confirm("trailer", "model-a");
    await expect(registry.keyFor("trailer", "model-b", createKey)).resolves.toBe("key-2");
    await registry.confirm("trailer", "model-b");
    await expect(registry.keyFor("trailer", "model-b", createKey)).resolves.toBe("key-3");
  });

  it("persists only the SHA-256 fingerprint and recovers the key after a same-tab reload", async () => {
    const values = new Map<string, string>();
    const storage: StorySubmissionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const rawFingerprint = "model prompt that must remain private";
    const storageKey = "project:trailer:create";
    const first = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    await expect(first.keyFor("create", rawFingerprint, () => "persisted-key")).resolves.toBe(
      "persisted-key"
    );
    expect(JSON.parse(values.get(storageKey) ?? "null")).toEqual({
      fingerprintHash: "fc5b8b1b0f2da38fa0a90278a848e47742ebae032f7b247a806cc9815df19158",
      key: "persisted-key",
    });
    expect(values.get(storageKey)).not.toContain(rawFingerprint);

    const afterReload = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    await expect(
      afterReload.keyFor("create", rawFingerprint, () => "duplicate-key")
    ).resolves.toBe("persisted-key");
    await afterReload.confirm("create", rawFingerprint);

    const afterConfirmation = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    await expect(
      afterConfirmation.keyFor("create", rawFingerprint, () => "rotated-key")
    ).resolves.toBe("rotated-key");
  });

  it("rejects and removes the former raw-fingerprint storage shape", async () => {
    const values = new Map([
      [
        "project:clip:create",
        JSON.stringify({ fingerprint: "raw private prompt", key: "legacy-key" }),
      ],
    ]);
    const storage: StorySubmissionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const registry = new StorySubmissionKeyRegistry("project:clip", () => storage);

    await expect(registry.keyFor("create", "raw private prompt", () => "new-key")).resolves.toBe(
      "new-key"
    );
    expect(JSON.parse(values.get("project:clip:create") ?? "null")).toMatchObject({
      fingerprintHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      key: "new-key",
    });
  });
});
