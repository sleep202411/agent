import { describe, expect, it } from "vitest";
import type { FilmTrailerSummary } from "@/lib/story-projects-api";
import {
  projectLockedTrailerPrompt,
  StorySubmissionKeyRegistry,
  type StorySubmissionStorage,
} from "./story-trailer-production-model";

describe("StorySubmissionKeyRegistry", () => {
  it("reuses ambiguous submissions, rotates on input changes, and clears only confirmed input", () => {
    const registry = new StorySubmissionKeyRegistry();
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;

    expect(registry.keyFor("trailer", "model-a", createKey)).toBe("key-1");
    expect(registry.keyFor("trailer", "model-a", createKey)).toBe("key-1");
    expect(registry.keyFor("trailer", "model-b", createKey)).toBe("key-2");
    registry.confirm("trailer", "model-a");
    expect(registry.keyFor("trailer", "model-b", createKey)).toBe("key-2");
    registry.confirm("trailer", "model-b");
    expect(registry.keyFor("trailer", "model-b", createKey)).toBe("key-3");
  });

  it("recovers an ambiguous key from storage after a same-tab page reload", () => {
    const values = new Map<string, string>();
    const storage: StorySubmissionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const first = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    expect(first.keyFor("create", "fingerprint", () => "persisted-key")).toBe("persisted-key");

    const afterReload = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    expect(afterReload.keyFor("create", "fingerprint", () => "duplicate-key")).toBe(
      "persisted-key"
    );
    afterReload.confirm("create", "fingerprint");

    const afterConfirmation = new StorySubmissionKeyRegistry("project:trailer", () => storage);
    expect(afterConfirmation.keyFor("create", "fingerprint", () => "rotated-key")).toBe(
      "rotated-key"
    );
  });
});

describe("projectLockedTrailerPrompt", () => {
  it("projects immutable direction when the mutable trailer draft is absent", () => {
    const trailer = {
      title: "Locked trailer",
      description: "Production snapshot",
      targetDurationMs: 6_000,
      generationControl: { mode: "omni_reference" },
      referenceRoleNotes: [],
      prompt: {
        masterPrompt: "Locked master prompt",
        negativeConstraints: ["No identity drift"],
        timeline: [
          {
            startMs: 0,
            endMs: 6_000,
            visual: "Villa at night",
            camera: "Slow push",
            action: "The gate opens",
          },
        ],
      },
      continuityNotes: ["Keep the red lantern lit"],
    } as unknown as FilmTrailerSummary;

    expect(projectLockedTrailerPrompt(trailer)).toMatchObject({
      title: "Locked trailer",
      masterDirection: "Locked master prompt",
      beats: [{ id: "trailer:locked:1", startMs: 0, endMs: 6_000 }],
      negativeConstraints: ["No identity drift"],
      continuityNotes: ["Keep the red lantern lit"],
    });
  });
});
