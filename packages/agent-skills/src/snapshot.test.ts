import { describe, expect, it } from "vitest";

import {
  projectSkillSnapshotChecksum,
  stableProjectSkillJson,
  verifyProjectSkillSnapshot,
} from "./snapshot.js";

describe("Project Skill snapshot integrity", () => {
  it("canonicalizes object key order", () => {
    expect(stableProjectSkillJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableProjectSkillJson({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it("rejects values outside canonical JSON", () => {
    expect(() => stableProjectSkillJson(undefined)).toThrow(/JSON values/);
    expect(() => stableProjectSkillJson(Number.NaN)).toThrow(/finite numbers/);
    expect(() => stableProjectSkillJson(new Date())).toThrow(/plain JSON objects/);
  });

  it("verifies a complete immutable resolution and rejects tampering", () => {
    const unsigned = {
      schemaVersion: "project-skill-resolution/v1" as const,
      resolutionId: "30000000-0000-7000-8000-000000000001",
      ownerKind: "story" as const,
      projectId: "40000000-0000-7000-8000-000000000001",
      projectRevision: 1,
      scope: "video_generation" as const,
      workbenchMode: "canvas",
      sourceSurface: "story-studio",
      resolvedAt: "2026-08-12T12:00:00.000Z",
      skills: [],
    };
    const snapshot = { ...unsigned, checksum: projectSkillSnapshotChecksum(unsigned) };
    expect(verifyProjectSkillSnapshot(snapshot)).toEqual(snapshot);
    expect(verifyProjectSkillSnapshot({ ...snapshot, projectRevision: 2 })).toBeNull();
  });
});
